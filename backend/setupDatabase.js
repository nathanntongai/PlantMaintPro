// backend/setupDatabase.js
const fs = require('fs');
const path = require('path');
const db = require('./db');

const runSQLFile = async (filePath) => {
  try {
    const sql = fs.readFileSync(filePath, 'utf8');
    console.log(`Executing SQL from ${path.basename(filePath)}...`);
    await db.query(sql);
    console.log(`✅ Successfully executed ${path.basename(filePath)}`);
  } catch (error) {
    console.error(`❌ Error executing ${path.basename(filePath)}:`, error);
    throw error;
  }
};

const runMigrations = async () => {
  try {
    console.log('Starting database migration...');
    
    // Run the main schema file first
    await runSQLFile(path.join(__dirname, 'database.sql'));

    console.log('✅ Database main schema created successfully!');
  } catch (error) {
    console.error('❌ Database migration failed.');
    process.exit(1); 
  }
};

runMigrations();