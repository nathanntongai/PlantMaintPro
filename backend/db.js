// backend/db.js (With conditional SSL)

const { Pool } = require('pg');

// Start with the basic config
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  port: process.env.DB_PORT,
};

// --- NEW CONDITIONAL LOGIC ---
// Only add SSL for production (like Render)
// process.env.NODE_ENV is "development" locally, so this is skipped
if (process.env.NODE_ENV !== 'development') {
  dbConfig.ssl = {
    rejectUnauthorized: false
  };
}
// --- END NEW LOGIC ---

const pool = new Pool(dbConfig);

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool: pool
};