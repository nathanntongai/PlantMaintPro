// backend/setupDatabase.js
const fs = require('fs');
const path = require('path');
const db = require('./db');

const runMigration = async () => {
  try {
    const sqlFilePath = path.join(__dirname, 'database.sql');
    const sql = fs.readFileSync(sqlFilePath, 'utf8');
    console.log('Starting database migration...');
    await db.query(sql);
    console.log('✅ Database migration completed successfully!');
  } catch (error) {
    console.error('❌ Error creating database tables:', error);
    process.exit(1);
  }
};
runMigration();