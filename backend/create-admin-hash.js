// backend/create-admin-hash.js
// This is a temporary script to generate one password hash.

const bcrypt = require('bcryptjs');
const saltRounds = 10;

// ---------------------------------------------------
// 1. CHANGE THIS PASSWORD to your desired admin password
// ---------------------------------------------------
const myPassword = 'Password@123'; 
// ---------------------------------------------------

console.log(`Hashing password: ${myPassword}`);

bcrypt.hash(myPassword, saltRounds, (err, hash) => {
  if (err) {
    console.error('Error hashing password:', err);
    return;
  }
  console.log('\n--- SUCCESS! Copy this hash: ---');
  console.log(hash);
  console.log('------------------------------------');
});