// backend/index.js
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./db');
const cors = require('cors');
const twilio = require('twilio');
const { authenticateToken, authorize } = require('./middleware/authMiddleware');

const app = express();
const PORT = 4000;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cors());

app.get('/', (req, res) => { res.send('Your PlantMaint Pro server is running!'); });

// --- WHATSAPP WEBHOOK ---
app.post('/whatsapp', async (req, res) => {
    const twiml = new twilio.twiml.MessagingResponse();
    let responseMessage = "Sorry, an error occurred.";
    try {
        const from = req.body.From;
        const msg_body = req.body.Body;
        const userResult = await db.query('SELECT * FROM users WHERE phone_number = $1', [from]);
        if (userResult.rows.length === 0) {
            responseMessage = "Sorry, your phone number is not registered in the system.";
        } else {
            const user = userResult.rows[0];
            const parts = msg_body.split(' ');
            const command = parts[0].toLowerCase();
            if (command === 'breakdown') { /* ... existing breakdown logic ... */ } 
            else if (command === 'status') { /* ... existing status logic ... */ } 
            else { responseMessage = `Sorry, I don't understand the command "${command}".`; }
        }
    } catch (error) { console.error("Error processing message:", error); }
    twiml.message(responseMessage);
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml.toString());
});

// --- AUTH ENDPOINTS ---
app.post('/register', async (req, res) => { /* ... existing registration logic ... */ });
app.post('/login', async (req, res) => { /* ... existing login logic ... */ });

// --- PROTECTED API ENDPOINTS ---
const ALL_ROLES = ['Maintenance Manager', 'Supervisor', 'Maintenance Technician', 'Operator'];
const MANAGER_AND_SUPERVISOR = ['Maintenance Manager', 'Supervisor'];
const MANAGER_ONLY = ['Maintenance Manager'];

// User Management
// UPDATED: Allow supervisors to get the list of users
app.get('/users', authenticateToken, authorize(MANAGER_AND_SUPERVISOR), async (req, res) => { 
    try { 
        const { companyId } = req.user; 
        const result = await db.query('SELECT id, name, email, role, phone_number FROM users WHERE company_id = $1 ORDER BY name ASC', [companyId]); 
        res.json(result.rows); 
    } catch (error) { 
        console.error('Error fetching users:', error); 
        res.status(500).json({ message: 'Internal server error' }); 
    } 
});
app.post('/users', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { /* ... existing add user logic ... */ });
app.patch('/users/:id', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { /* ... existing edit user logic ... */ });
app.delete('/users/:id', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { /* ... existing delete user logic ... */ });

// ... (All other endpoints for machines, breakdowns, etc. remain the same) ...

// --- SERVER STARTUP ---
app.listen(PORT, () => {
  console.log(`Server is running successfully on http://localhost:${PORT}`);
});