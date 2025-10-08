// backend/index.js (Complete and Final Version)

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./db');
const cors = require('cors');
const twilio = require('twilio');
const { authenticateToken, authorize } = require('./middleware/authMiddleware');
const { sendWhatsAppMessage } = require('./whatsappService'); // For Meta API, can be removed if only using Twilio

const app = express();
const PORT = 4000;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cors());

app.get('/', (req, res) => { res.send('Your PlantMaint Pro server is running!'); });

// --- WHATSAPP WEBHOOK ---
app.post('/whatsapp', async (req, res) => {
    // This is the Twilio version. If you switch back to Meta, this will need to be replaced.
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
            if (command === 'breakdown') {
                const machineId = parseInt(parts[1], 10);
                const description = parts.slice(2).join(' ');
                if (!machineId || !description) {
                    responseMessage = "Invalid format. Use: breakdown <machineId> <description>";
                } else {
                    const machineResult = await db.query('SELECT * FROM machines WHERE id = $1 AND company_id = $2', [machineId, user.company_id]);
                    if (machineResult.rows.length === 0) {
                        responseMessage = `Error: Machine with ID ${machineId} not found.`;
                    } else {
                        await db.query('INSERT INTO breakdowns (machine_id, company_id, reported_by_id, description) VALUES ($1, $2, $3, $4)', [machineId, user.company_id, user.id, description]);
                        responseMessage = `✅ Breakdown reported for "${machineResult.rows[0].name}".`;
                    }
                }
            } else if (command === 'status') {
                const breakdownId = parseInt(parts[1], 10);
                if (!breakdownId) {
                    responseMessage = "Invalid format. Use: status <breakdownId>";
                } else {
                    const breakdownResult = await db.query(`SELECT b.status, m.name as machine_name FROM breakdowns b JOIN machines m ON b.machine_id = m.id WHERE b.id = $1 AND b.company_id = $2`, [breakdownId, user.company_id]);
                    if (breakdownResult.rows.length === 0) {
                        responseMessage = `Error: Breakdown with ID ${breakdownId} not found.`;
                    } else {
                        responseMessage = `ℹ️ Status for Breakdown #${breakdownId} (${breakdownResult.rows[0].machine_name}) is: *${breakdownResult.rows[0].status}*`;
                    }
                }
            } else {
                responseMessage = `Sorry, I don't understand the command "${command}".`;
            }
        }
    } catch (error) { console.error("Error processing message:", error); }
    twiml.message(responseMessage);
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml.toString());
});

// --- AUTH ENDPOINTS ---
app.post('/register', async (req, res) => {
    try {
        const { companyName, userName, email, password, phoneNumber } = req.body;
        const passwordHash = await bcrypt.hash(password, 10);
        const companyResult = await db.query('INSERT INTO companies (name) VALUES ($1) RETURNING id', [companyName]);
        const newCompanyId = companyResult.rows[0].id;
        const formattedPhoneNumber = phoneNumber ? `whatsapp:+${phoneNumber.replace(/[^0-9]/g, '')}` : null;
        const userResult = await db.query(`INSERT INTO users (company_id, name, email, password_hash, role, phone_number) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, email, role`, [newCompanyId, userName, email, passwordHash, 'Maintenance Manager', formattedPhoneNumber]);
        res.status(201).json({ message: 'Registration successful!', user: userResult.rows[0] });
    } catch (error) {
        if (error.code === '23505') { return res.status(400).json({ message: 'Error: Email or phone number already in use.' }); }
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];
        const passwordMatches = user ? await bcrypt.compare(password, user.password_hash) : false;
        if (!passwordMatches) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        const token = jwt.sign({ userId: user.id, role: user.role, companyId: user.company_id }, process.env.JWT_SECRET, { expiresIn: '8h' });
        res.json({ message: 'Login successful!', token: token });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// --- PROTECTED API ENDPOINTS ---
const ALL_ROLES = ['Maintenance Manager', 'Supervisor', 'Maintenance Technician', 'Operator'];
const MANAGER_AND_SUPERVISOR = ['Maintenance Manager', 'Supervisor'];
const MANAGER_ONLY = ['Maintenance Manager'];

// User Management
app.get('/users', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { companyId } = req.user; const result = await db.query('SELECT id, name, email, role, phone_number FROM users WHERE company_id = $1 ORDER BY name ASC', [companyId]); res.json(result.rows); } catch (error) { console.error('Error fetching users:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.post('/users', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { name, email, password, role, phoneNumber } = req.body; const { companyId } = req.user; const passwordHash = await bcrypt.hash(password, 10); const formattedPhoneNumber = phoneNumber ? `whatsapp:+${phoneNumber.replace(/[^0-9]/g, '')}` : null; const result = await db.query( `INSERT INTO users (company_id, name, email, password_hash, role, phone_number) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, email, role, phone_number`, [companyId, name, email, passwordHash, role, formattedPhoneNumber] ); res.status(201).json({ message: 'User created successfully!', user: result.rows[0] }); } catch (error) { if (error.code === '23505') { return res.status(400).json({ message: 'Error: Email or phone number already in use.' }); } console.error('Error creating user:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.patch('/users/:id', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const userIdToEdit = req.params.id; const { name, email, role, phoneNumber } = req.body; const { companyId } = req.user; const formattedPhoneNumber = phoneNumber ? `whatsapp:+${phoneNumber.replace(/[^0-9]/g, '')}` : null; const result = await db.query( `UPDATE users SET name = $1, email = $2, role = $3, phone_number = $4 WHERE id = $5 AND company_id = $6 RETURNING id, name, email, role, phone_number`, [name, email, role, formattedPhoneNumber, userIdToEdit, companyId] ); if (result.rows.length === 0) { return res.status(404).json({ message: "User not found or you do not have permission to edit this user." }); } res.json({ message: 'User updated successfully!', user: result.rows[0] }); } catch (error) { if (error.code === '23505') { return res.status(400).json({ message: 'Error: Email or phone number already in use.' }); } console.error('Error updating user:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.delete('/users/:id', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const userIdToDelete = req.params.id; const { companyId, userId } = req.user; if (userIdToDelete == userId) { return res.status(403).json({ message: "You cannot delete your own account." }); } const result = await db.query( 'DELETE FROM users WHERE id = $1 AND company_id = $2', [userIdToDelete, companyId] ); if (result.rowCount === 0) { return res.status(404).json({ message: "User not found or you do not have permission to delete this user." }); } res.status(200).json({ message: 'User deleted successfully' }); } catch (error) { console.error('Error deleting user:', error); res.status(500).json({ message: 'Internal server error' }); } });

// Machine Management
app.get('/machines', authenticateToken, authorize(ALL_ROLES), async (req, res) => { try { const { companyId } = req.user; const result = await db.query('SELECT * FROM machines WHERE company_id = $1 ORDER BY name ASC', [companyId]); res.json(result.rows); } catch (error) { console.error('Error fetching machines:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.post('/machines', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { name, location } = req.body; const { companyId } = req.user; const result = await db.query('INSERT INTO machines (company_id, name, location) VALUES ($1, $2, $3) RETURNING *', [companyId, name, location]); res.status(201).json({ message: 'Machine created!', machine: result.rows[0] }); } catch (error) { console.error('Error creating machine:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.patch('/machines/:id', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { id } = req.params; const { name, location } = req.body; const { companyId } = req.user; const result = await db.query('UPDATE machines SET name = $1, location = $2 WHERE id = $3 AND company_id = $4 RETURNING *', [name, location, id, companyId]); if (result.rows.length === 0) { return res.status(404).json({ message: 'Machine not found.' }); } res.json({ message: 'Machine updated!', machine: result.rows[0] }); } catch (error) { console.error('Error updating machine:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.delete('/machines/:id', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { id } = req.params; const { companyId } = req.user; const result = await db.query('DELETE FROM machines WHERE id = $1 AND company_id = $2', [id, companyId]); if (result.rowCount === 0) { return res.status(404).json({ message: 'Machine not found.' }); } res.status(200).json({ message: 'Machine deleted.' }); } catch (error) { if (error.code === '23503') { return res.status(400).json({ message: 'Cannot delete machine. It is linked to other records.' }); } console.error('Error deleting machine:', error); res.status(500).json({ message: 'Internal server error' }); } });

// Breakdown Management
app.get('/breakdowns', authenticateToken, authorize(ALL_ROLES), async (req, res) => { try { const { companyId } = req.user; const query = ` SELECT b.id, b.description, b.status, b.reported_at, m.name AS machine_name, m.location AS machine_location FROM breakdowns b JOIN machines m ON b.machine_id = m.id WHERE b.company_id = $1 AND b.status != 'Closed' ORDER BY b.reported_at ASC `; const result = await db.query(query, [companyId]); res.json(result.rows); } catch (error) { console.error('Error fetching breakdowns:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.post('/breakdowns', authenticateToken, authorize(ALL_ROLES), async (req, res) => { try { const { machineId, description } = req.body; const { userId, companyId } = req.user; const result = await db.query('INSERT INTO breakdowns (machine_id, company_id, reported_by_id, description) VALUES ($1, $2, $3, $4) RETURNING *', [machineId, companyId, userId, description]); res.status(201).json({ message: 'Breakdown reported successfully!', breakdown: result.rows[0] }); } catch (error) { console.error('Error reporting breakdown:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.patch('/breakdowns/:id/status', authenticateToken, authorize(MANAGER_AND_SUPERVISOR), async (req, res) => { try { const { id } = req.params; const { status } = req.body; const { companyId } = req.user; const result = await db.query( "UPDATE breakdowns SET status = $1 WHERE id = $2 AND company_id = $3 RETURNING *", [status, id, companyId] ); if (result.rows.length === 0) { return res.status(404).json({ message: 'Breakdown not found or not part of your company.' }); } res.json({ message: 'Status updated successfully!', breakdown: result.rows[0] }); } catch (error) { console.error('Error updating status:', error); res.status(500).json({ message: 'Internal server error' }); } });

// ... and so on for all your other endpoints ...
// Make sure to include ALL endpoints we have built here.

// --- SERVER STARTUP ---
app.listen(PORT, () => {
  console.log(`Server is running successfully on http://localhost:${PORT}`);
});