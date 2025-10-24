// backend/db.js (With SSL Enabled for Render)

const { Pool } = require('pg');

// We will use the environment variables that Render provides
const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  port: process.env.DB_PORT,

  // ADD THIS LINE TO ENABLE SSL
  ssl: {
    rejectUnauthorized: false
  }
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};