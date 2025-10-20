// backend/setupDatabase.js (Runs both scripts)

const fs = require('fs');
const path = require('path');
const db = require('./db'); // Ensure db.js uses process.env directly

const runSQLFile = async (filePath) => {
  try {
    const sql = fs.readFileSync(filePath, 'utf8');
    console.log(`Executing SQL from ${path.basename(filePath)}...`);
    await db.query(sql);
    console.log(`✅ Successfully executed ${path.basename(filePath)}`);
  } catch (error) {
    console.error(`❌ Error executing ${path.basename(filePath)}:`, error);
    throw error; // Re-throw the error to stop the process
  }
};

const runMigrations = async () => {
  try {
    console.log('Starting database migration...');
    
    // Run the main schema file first
    await runSQLFile(path.join(__dirname, 'database.sql'));
    
    // Run the alteration script second
    //await runSQLFile(path.join(__dirname, 'alter_schema.sql'));

    console.log('✅ Database migration completed successfully!');
  } catch (error) {
    console.error('❌ Database migration failed.');
    // Exit with an error code to signal failure
    process.exit(1); 
  } finally {
     // Ensure the pool closes, otherwise the script might hang
     // You might need to add a pool.end() method to your db.js export
     // For now, we'll rely on the process exiting.
     // If your db.js exports the pool directly:
     // if (db.pool && db.pool.end) {
     //   await db.pool.end();
     //   console.log('Database pool closed.');
     // }
  }
};

runMigrations();