// backend/setupDatabase.js (Simplified)
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
    process.exit(1); // Exit with an error
  } finally {
    // This isn't strictly necessary but is good practice if db.js exports the pool
    // if (db.pool && db.pool.end) {
    //   await db.pool.end();
    // }
  }
};

runMigration();