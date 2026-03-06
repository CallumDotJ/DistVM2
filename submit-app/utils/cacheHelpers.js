const fs = require("fs/promises");
const path = require("path");

async function readCache(cachePath) {
  try {
    const data = await fs.readFile(cachePath, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading cache:", err);
    return null;
  }
}

async function writeCache(cachePath, data) {
  try {
    const dir = path.dirname(cachePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("Error writing to cache:", err);
  }
}

module.exports = { readCache, writeCache };