// setupDatabase.js

const fs = require('fs'); // Node.js File System module to read files
const path = require('path');
const db = require('./db'); // Our database connection pool

const runMigration = async () => {
  try {
    // Construct the absolute path to the SQL file
    const sqlFilePath = path.join(__dirname, 'database.sql');

    // Read the SQL file content
    const sql = fs.readFileSync(sqlFilePath, 'utf8');

    console.log('Starting database migration...');

    // Execute the SQL commands
    await db.query(sql);

    console.log('✅ Database tables created successfully!');
  } catch (error) {
    console.error('❌ Error creating database tables:', error);
  }
};

runMigration();