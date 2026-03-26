const express = require("express");
const router = express.Router();
const path = require("path");
const amqp = require("amqplib");
const { readCache, writeCache } = require("../utils/cacheHelpers");

const QUEUE_NAME = process.env.QUEUE_NAME || "submit_queue";
const TYPE_CONSUME_QUEUE =
  process.env.TYPE_CONSUME_QUEUE || "type_consume_queue";
const EXCHANGE = "type_update_exchange";

const CONSTR =
  process.env.AMQP_URL ||
  `amqp://${RABBITMQ_DEFAULT_USER}:${RABBITMQ_DEFAULT_PASS}@${RABBITMQ_HOST}:${RABBITMQ_PORT}`;

// Misc
const TYPES_CACHE_PATH =
  process.env.TYPE_CACHE_PATH || "../cache/typeCache.json";

let gConnection; // file scope for functions
let gChannel;

createQueueConnection(); // create connection to RMQ when server starts

/**
 * @swagger
 * /types:
 *   get:
 *     summary: Get all joke types
 *     responses:
 *       200:
 *         description: A list of joke types
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 types:
 *                   type: array
 *                   items:
 *                     type: string
 */

router.get("/types", async (req, res) => {
  // get from cache
  const cached = await readCache(TYPES_CACHE_PATH);

  if (cached && cached.length > 0) {
    return res.json({ types: cached, source: "cache" });
  }

  // if no cache available
  return res
    .status(503)
    .json({ error: "types unavailable (joke down + no cache)" });
  //}
});

/**
 * @swagger
 * /submit:
 *   post:
 *     summary: Submit a new joke
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [setup, punchline, type]
 *             properties:
 *               setup: { type: string, example: "why did the chicken cross the road?" }
 *               punchline: { type: string, example: "to get to the other side." }
 *               type: { type: string, example: "dad" }
 *     responses:
 *       201:
 *         description: Joke submitted
 *       400:
 *         description: Validation error
 */

// REMOVE  THIS ONEEEEE
/* router.post("/submit", async (req, res) => {
  try {
    // read inputs
    const setup = req.body.setup.trim();
    const punchline = req.body.punchline.trim();
    const type = req.body.type.trim().toLowerCase();

    // validate
    if (!setup || !punchline || !type) {
      return res
        .status(400)
        .json({ error: "please provide setup punchline and type" });
    }

    if (setup.length < 3 || punchline.length < 3 || type.length < 3) {
      return res
        .status(400)
        .json({ error: "setup punchline type must be at least 3 characters" });
    }

    // check if type exists, if not add it - retrive id too
    let rows = await query(
      `SELECT id FROM tbl_type WHERE LOWER(type) = LOWER(?) LIMIT 1`,
      [type],
    );

    let typeId;

    if (rows.length === 0) {
      const result = await query(`INSERT INTO tbl_type (type) VALUES (?)`, [
        type,
      ]);
      typeId = result.insertId; // get new type id
    } else {
      typeId = rows[0].id; // get existing type id
    }

    // insert joke with type id
    await query(
      `INSERT INTO tbl_jokes (setup, punchline, type) VALUES (?, ?, ?)`,
      [setup, punchline, typeId],
    );
    // respond to front
    res.json({ message: "joke submitted successfully" });
  } catch (error) {
    console.error("post submit error:", error);
    res.status(500).json({ error: "error processing submission - db error" });
  }
});
 */
router.post("/submit", async (req, res) => {
  // queue submission endpoint - accepts same input but sends to queue

  try {
    // read inputs
    const setup = req.body.setup.trim();
    const punchline = req.body.punchline.trim();
    const type = req.body.type.trim().toLowerCase();


    // validate exist and not whiespace
    if (
      setup.trim().length < 1 ||
      punchline.trim().length < 1 ||
      type.trim().length < 1
    ) {
      return res.status(400).json({
        error: "fields cannot be empty",
      });
    }


    // send to queue
    let msg = { setup: setup, punchline: punchline, type: type };

    await sendMsg(gChannel, msg); // send the joke to queue.

    res.json({ message: "joke submitted to queue successfully" });
  } catch (error) 
  { 
    // error submitting
    console.error("post /submit error:", error);
    res.status(500)
      .json({ error: "error processing submission - queue error" });
  }
});
 
// --  RABBITMQ BASED FUNCTIONS  -- \\

// attempt the connection  and save into the assigned gloabl variables
async function createQueueConnection() {

  for (let i = 0; i < 5 && !gConnection; i++) { // attempt connect 

    await new Promise((resolve) => setTimeout(resolve, 2000)); // use promise to wait before retrying connection - give rmq time to start

    try {

      // connect and save
      const rmq = await createConnection(CONSTR);
      gConnection = rmq.connection;
      gChannel = rmq.channel;

      gConnection.on("error", (err) => {
        console.log(`Connection error: ${err}`);
      });

      gConnection.on("close", () => {
        console.log(`Connection closed`);
      });
    } catch (err) 
    {
      console.log(`Failed to connect to RabbitMQ: ${err.message}`);
    }
  }
}

// close the queue connection
/* async function closeConnection(connection, channel) {
  try {
    await channel.close();
    await connection.close();
    console.log(`Connection and channel closed`);
  } catch (err) {
    console.log(`Failed to close connection. ${err}`);
  }
} */

// create connection to rmq and connect to queues and exchange
async function createConnection(conStr) {
  try {
    const connection = await amqp.connect(conStr); // create the tcp connection   
    console.log(`Connected to rabbitmq using ${conStr}`);

    const channel = await connection.createChannel(); // create a channel within the connection. 
    console.log(`Channel created`);

    // subscribe to exchange
    await channel.assertExchange(EXCHANGE, "fanout", { durable: true });
    // create own queue to consume exchange
    const q = await channel.assertQueue(TYPE_CONSUME_QUEUE, { durable: true });
    // bind the q to the exchange for subscription
    await channel.bindQueue(q.queue, EXCHANGE, "");
    // get 1 first
    await channel.prefetch(1);

    // on consume from exchange
    await channel.consume(q.queue, async (msg) => {
      if (!msg) return;

      // validate first 
      try {
        // temp obj for extract
        const obj = JSON.parse(msg.content.toString());
        const types = obj?.types;

        // check if array
        if (!Array.isArray(types)) {
          console.log("invalid structure of TYPES - not array format.");
          channel.ack(msg); // remove from queue
          return;
        } 


        // save to cache
        await writeCache(TYPES_CACHE_PATH, types);
        console.log(`SUBMIT says: cache refreshed with ${types.length} types`);

        // acknowledge message in queue
        channel.ack(msg);
      } catch (err) {
        console.log(`Failed to process type_update event: ${err.message}`);
        channel.nack(msg, false, true); // return for requeing as might be temp failure
      }
    });

    return { connection, channel };
  } catch (err) {
    console.log(`Failed to connect to queue in createConection function`);
    throw err;
  }
}

// send message to queue - takes the channel and the to be inputted message
async function sendMsg(channel, msg) {

  try {
    // ensure queue
    const res = await channel.assertQueue(QUEUE_NAME, { durable: true });
    console.log(`${QUEUE_NAME} queue created / accessed`);

    // send message
    channel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(msg)), {
      persistent: true,
    });
    console.log(msg);
  } catch (err) 
  {
    console.log(`Failed to write to ${QUEUE_NAME} queue.${err}`);
    throw err;
  }
}

module.exports = router;
