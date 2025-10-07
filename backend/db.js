// db.js

// 1. Import the 'dotenv' library to manage environment variables
require('dotenv').config();

// 2. Import the Pool class from the 'pg' library
// A connection pool is more efficient than creating a new connection for every query.
const { Pool } = require('pg');

// 3. Create a new Pool instance with our database configuration
// The library automatically looks for the environment variables we set in the .env file.
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// 4. Export the pool object
// This allows us to import and use it in other files in our project.
module.exports = {
  query: (text, params) => pool.query(text, params),
};