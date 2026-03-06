const swaggerJsdoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Submit API",
      version: "1.0.0",
    },
  },
  apis: ["./routes/*.js", "server.js"], // MUST be an ARRAY
};

module.exports = swaggerJsdoc(options);
