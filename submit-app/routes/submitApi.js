const express = require('express');
const router = express.Router();
//const jokes = require('../tempData/jokes.json');
//const mysql = require('mysql2');
const path = require('path')
const amqp = require('amqplib');
const axios = require('axios');
const { readCache, writeCache } = require('../utils/cacheHelpers');



// RMQ connection setup - using env vars
const RMQ_USER_NAME = process.env.RABBITMQ_DEFAULT_USER || "admin";
const RMQ_PASSWORD = process.env.RABBITMQ_DEFAULT_PASS || "admin";
const RMQ_HOST = process.env.RABBITMQ_HOST || "rabbitmq";
const RMQ_PORT = process.env.RABBITMQ_PORT || 5672;
const QUEUE_NAME = process.env.QUEUE_NAME || "submit_queue";

// Misc
const JOKE_BASE_URL = process.env.JOKE_BASE_URL || "http://localhost:3001";
const TYPES_CACHE_PATH = process.env.TYPE_CACHE_PATH || "../cache/typeCache.json"

let gConnection // file scope for functions
let gChannel

createQueueConnection() // create connection to RMQ when server starts

// query promise
const query = (sql, params) => {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, results) => {
            if (err) {
                return reject(err);
            } else {
                resolve(results);
            }
        });
    });
}

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


// New Type
// router.get('/types', (req, res) => {
//     let sql = `SELECT * FROM tbl_type`
//     db.query(sql, (err, results) => {
//         if (err) {
//             res.status(500).json({ error: "database error retrieving types" }) // 500 error
//         }
//         res.json({ types: results.map(result => result.type) }) // just return type string, not whole record
//     })
// })


router.get("/types", async (req, res) => {
  try {

    // fetch from master source
    const resp = await axios.get(`${JOKE_BASE_URL}/types`, { timeout: 1500 });

    console.log("Fetched types from joke service:", resp.data); // log the response for debugging

	// expected ==  { types: ["dad", "programming"] }
    const types = resp?.data?.types;

    if (!Array.isArray(types)) {
      return res.status(502).json({ error: "invalid response from joke service" });
    }

    // refresh cache every time
    await writeCache(TYPES_CACHE_PATH, types);

    // return fresh types
    return res.json({ types, source: "joke-service" });
  } catch (err) {
    console.log("jke service /types failed, using cache:", err.message);

    // fallback to cache file
    const cached = await readCache(TYPES_CACHE_PATH);

    if (cached && cached.length > 0) {
      return res.json({ types: cached, source: "cache" });
    }

    // if no cache available
    return res.status(503).json({ error: "types unavailable (joke down + no cache)" });
  }
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
router.post('/submit', async (req, res) =>  {
    try {
    // read inputs
    const setup = req.body.setup.trim();
    const punchline = req.body.punchline.trim();
    const type = req.body.type.trim().toLowerCase();

    // validate
    if(!setup || !punchline || !type) {
        return res.status(400).json({ error: 'please provide setup punchline and type' });
    }

    if(setup.length < 3 || punchline.length < 3 || type.length < 3) {
        return res.status(400).json({ error: 'setup punchline type must be at least 3 characters' });
    }


    // check if type exists, if not add it - retrive id too
    let rows = await query(`SELECT id FROM tbl_type WHERE LOWER(type) = LOWER(?) LIMIT 1`, [type]);

    let typeId;

    if(rows.length === 0) {
        const result = await query(`INSERT INTO tbl_type (type) VALUES (?)`, [type]);
        typeId = result.insertId; // get new type id
    }
    else {
        typeId = rows[0].id; // get existing type id
    }

    // insert joke with type id
    await query(`INSERT INTO tbl_jokes (setup, punchline, type) VALUES (?, ?, ?)`, [setup, punchline, typeId]);
    // respond to front
    res.json({ message: 'joke submitted successfully' });

    }
    catch(error) {
        console.error("post submit error:", error);
        res.status(500).json({ error: 'error processing submission - db error' });
    }

})

router.post('/submitQueue', async (req, res) => {
    // queue submission endpoint - accepts same input but sends to queue 
   
    try {

    // read inputs
    const setup = req.body.setup.trim();
    const punchline = req.body.punchline.trim();
    const type = req.body.type.trim().toLowerCase();

    // validate
    if(!setup || !punchline || !type) {
        return res.status(400).json({ error: 'please provide setup punchline and type' });
    }

    if(setup.length < 3 || punchline.length < 3 || type.length < 3) {
        return res.status(400).json({ error: 'setup punchline type must be at least 3 characters' });
    }

    // send to queue 

    let msg = {setup: setup, punchline: punchline, type: type };

    await sendMsg(gChannel, msg) // send the joke to queue.

    res.json({ message: 'joke submitted to queue successfully' });

    }
    catch(error) 
    {
    console.error("post submitQueue error:", error);
    res.status(500).json({ error: 'error processing submission - queue error' });
    }
});

/* --- Functions --- */

async function createQueueConnection() {
  
  const conStr = `amqp://${RMQ_USER_NAME}:${RMQ_PASSWORD}@${RMQ_HOST}:${RMQ_PORT}/`
  for(let i=0; i<5 && !gConnection; i++) {

    await new Promise(resolve => setTimeout(resolve, 2000)) // wait before retrying connection - give rmq time to start

  try {

    console.log(`Trying to connect to RabbitMQ at ${RMQ_HOST}:${RMQ_PORT}`) // REMOVE AFTER TESTS
    const rmq = await createConnection(conStr) 
    gConnection = rmq.connection  
    gChannel = rmq.channel

    gConnection.on('error', (err) => {
      console.log(`Connection error: ${err}`)
    })
    
    // listens to connection close event - term app if connectction closed.
    gConnection.on('close', () => {
      console.log(`Connection closed`)
    })
  }
  catch (err) {
    console.log(`Failed to connect to RabbitMQ: ${err.message}`)
  }
}
}

// close the queue connection
async function closeConnection(connection, channel) {
  try {
    await channel.close()
    await connection.close()
    console.log(`Connection and channel closed`)
  } catch (err) {
    console.log(`Failed to close connection. ${err}`)
  }
}

// create connection to rmq
async function createConnection(conStr) {
  try {
    const connection = await amqp.connect(conStr) // Create tcp connection   // Create connection
    console.log(`Connected to rabbitmq using ${conStr}`)

    const channel = await connection.createChannel() // create a channel withing the connection. Can have many concurrent channels   // Create channel. Channel can have multiple queues
    console.log(`Channel created`)

    return { connection, channel } 

  } catch (err) {
    console.log(`Failed to connect to queue in createConection function`)
    throw err
  }
}


// sendmessage to queue
async function sendMsg(channel, msg) {
  try {
    const res = await channel.assertQueue(QUEUE_NAME, { durable: true })   
    console.log(`${QUEUE_NAME} queue created / accessed`)
    await channel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(msg)), { persistent: true }) 
    console.log(msg)
  } catch (err) {
    console.log(`Failed to write to ${QUEUE_NAME} queue.${err}`)
    throw err;
  }
}


module.exports = router;