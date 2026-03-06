const express = require('express');
//const jokes = require('data/jokes');
const path = require('path');
const swaggerSpec = require('./swagger');
const swaggerUi = require('swagger-ui-express');

const submitApiRouter = require('./routes/submitApi');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json()); // for parsing application/json
app.use(express.urlencoded({ extended: true })); // for parsing application/urlencoded

app.use(express.static(path.join(__dirname, 'public'))); //serve static files from public directory
app.use('/', submitApiRouter);

/**
 * @swagger
 * /docs:
 *   get:
 *     summary: Swagger UI documentation
 *     responses:
 *       200:
 *         description: Swagger UI
 */
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running on port ${PORT}`);
});

