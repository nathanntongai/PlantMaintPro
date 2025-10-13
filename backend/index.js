// backend/index.js (Definitive Final Version)

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

// --- CONVERSATIONAL WHATSAPP WEBHOOK ---
app.post('/whatsapp', async (req, res) => {
    const twiml = new twilio.twiml.MessagingResponse();
    let responseMessage = "Sorry, an error occurred. Please try again later.";

    try {
        const from = req.body.From;
        const msg_body = req.body.Body.trim();
        console.log(`Incoming Twilio message from ${from}: "${msg_body}"`);

        const userResult = await db.query('SELECT * FROM users WHERE phone_number = $1', [from]);
        if (userResult.rows.length === 0) {
            responseMessage = "Sorry, your phone number is not registered in the PlantMaint Pro system.";
        } else {
            const user = userResult.rows[0];
            const currentState = user.whatsapp_state || 'IDLE';
            let context = user.whatsapp_context || {};

            switch (currentState) {
                case 'IDLE':
                    responseMessage = "Please choose an option:\n1. Report Breakdown\n2. Check Status";
                    await db.query("UPDATE users SET whatsapp_state = 'AWAITING_MENU_CHOICE' WHERE id = $1", [user.id]);
                    break;

                case 'AWAITING_MENU_CHOICE':
                    if (msg_body === '1') { // User chose "Report Breakdown"
                        const machinesResult = await db.query('SELECT id, name FROM machines WHERE company_id = $1 ORDER BY name ASC', [user.company_id]);
                        if (machinesResult.rows.length === 0) {
                            responseMessage = "No machines are registered. Please add machines in the web dashboard first.";
                            await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                        } else {
                            let machineList = "Please reply with the number of the machine that has broken down:\n";
                            const machineIdMap = machinesResult.rows.map(m => m.id);
                            machinesResult.rows.forEach((machine, index) => { machineList += `${index + 1}. ${machine.name}\n`; });
                            responseMessage = machineList;
                            context.machine_id_map = machineIdMap;
                            await db.query("UPDATE users SET whatsapp_state = 'AWAITING_MACHINE_CHOICE', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                        }
                    } else if (msg_body === '2') { // User chose "Check Status"
                        responseMessage = "Please reply with the Breakdown ID number to check its status.";
                        await db.query("UPDATE users SET whatsapp_state = 'AWAITING_STATUS_ID' WHERE id = $1", [user.id]);
                    } else {
                        responseMessage = "Invalid option. Please choose:\n1. Report Breakdown\n2. Check Status";
                    }
                    break;
                
                case 'AWAITING_MACHINE_CHOICE':
                    const choiceIndex = parseInt(msg_body, 10) - 1;
                    if (context.machine_id_map && choiceIndex >= 0 && choiceIndex < context.machine_id_map.length) {
                        context.selected_machine_id = context.machine_id_map[choiceIndex];
                        responseMessage = "Is the issue:\n1. Electrical\n2. Mechanical";
                        await db.query("UPDATE users SET whatsapp_state = 'AWAITING_ISSUE_TYPE', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                    } else {
                        responseMessage = "Invalid machine number. Please try again.";
                    }
                    break;

                case 'AWAITING_ISSUE_TYPE':
                    let issueType = '';
                    if (msg_body === '1') issueType = 'Electrical';
                    if (msg_body === '2') issueType = 'Mechanical';
                    if (issueType) {
                        context.issue_type = issueType;
                        responseMessage = "Thank you. Please provide a brief description of the issue.";
                        await db.query("UPDATE users SET whatsapp_state = 'AWAITING_DESCRIPTION', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                    } else {
                        responseMessage = "Invalid choice. Please reply with 1 for Electrical or 2 for Mechanical.";
                    }
                    break;

                case 'AWAITING_DESCRIPTION':
                    const description = `${context.issue_type} Issue: ${msg_body}`;
                    const machineId = context.selected_machine_id;
                    await db.query('INSERT INTO breakdowns (machine_id, company_id, reported_by_id, description) VALUES ($1, $2, $3, $4)', [machineId, user.company_id, user.id, description]);
                    responseMessage = `✅ Breakdown reported successfully for machine ID #${machineId}. A team will be dispatched.`;
                    await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                    break;
                
                case 'AWAITING_STATUS_ID':
                    const breakdownId = parseInt(msg_body, 10);
                    if (!breakdownId) {
                        responseMessage = "Invalid ID. Please reply with the Breakdown ID number.";
                    } else {
                        const breakdownResult = await db.query(`SELECT b.status, m.name as machine_name FROM breakdowns b JOIN machines m ON b.machine_id = m.id WHERE b.id = $1 AND b.company_id = $2`, [breakdownId, user.company_id]);
                        if (breakdownResult.rows.length === 0) {
                            responseMessage = `Error: Breakdown with ID ${breakdownId} was not found.`;
                        } else {
                            const b = breakdownResult.rows[0];
                            responseMessage = `ℹ️ Status for Breakdown #${breakdownId} (${b.machine_name}) is: *${b.status}*`;
                        }
                        await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                    }
                    break;

                default:
                    responseMessage = "Sorry, I got confused. Let's start over.\nPlease choose an option:\n1. Report Breakdown\n2. Check Status";
                    await db.query("UPDATE users SET whatsapp_state = 'AWAITING_MENU_CHOICE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                    break;
            }
        }
    } catch (error) {
        console.error("Error processing Twilio message:", error);
    }
    twiml.message(responseMessage);
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml.toString());
});

// --- AUTH ENDPOINTS ---
app.post('/register', async (req, res) => { try { const { companyName, userName, email, password, phoneNumber } = req.body; const passwordHash = await bcrypt.hash(password, 10); const companyResult = await db.query('INSERT INTO companies (name) VALUES ($1) RETURNING id', [companyName]); const newCompanyId = companyResult.rows[0].id; const formattedPhoneNumber = phoneNumber ? `whatsapp:+${phoneNumber.replace(/[^0-9]/g, '')}` : null; const userResult = await db.query(`INSERT INTO users (company_id, name, email, password_hash, role, phone_number) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, email, role`, [newCompanyId, userName, email, passwordHash, 'Maintenance Manager', formattedPhoneNumber]); res.status(201).json({ message: 'Registration successful!', user: userResult.rows[0] }); } catch (error) { if (error.code === '23505') { return res.status(400).json({ message: 'Error: Email or phone number already in use.' }); } console.error('Registration error:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.post('/login', async (req, res) => { try { const { email, password } = req.body; const query = `SELECT u.*, c.name as company_name FROM users u JOIN companies c ON u.company_id = c.id WHERE u.email = $1`; const result = await db.query(query, [email]); const user = result.rows[0]; const passwordMatches = user ? await bcrypt.compare(password, user.password_hash) : false; if (!passwordMatches) { return res.status(401).json({ message: 'Invalid credentials' }); } const token = jwt.sign({ userId: user.id, role: user.role, companyId: user.company_id }, process.env.JWT_SECRET, { expiresIn: '8h' }); delete user.password_hash; res.json({ message: 'Login successful!', token: token, user: user }); } catch (error) { console.error('Login error:', error); res.status(500).json({ message: 'Internal server error' }); } });

// --- PROTECTED API ENDPOINTS ---
const ALL_ROLES = ['Maintenance Manager', 'Supervisor', 'Maintenance Technician', 'Operator'];
const MANAGER_AND_SUPERVISOR = ['Maintenance Manager', 'Supervisor'];
const MANAGER_ONLY = ['Maintenance Manager'];

// User Management
app.get('/users', authenticateToken, authorize(MANAGER_AND_SUPERVISOR), async (req, res) => { try { const { companyId } = req.user; const result = await db.query('SELECT id, name, email, role, phone_number FROM users WHERE company_id = $1 ORDER BY name ASC', [companyId]); res.json(result.rows); } catch (error) { console.error('Error fetching users:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.post('/users', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { name, email, password, role, phoneNumber } = req.body; const { companyId } = req.user; const passwordHash = await bcrypt.hash(password, 10); const formattedPhoneNumber = phoneNumber ? `whatsapp:+${phoneNumber.replace(/[^0-9]/g, '')}` : null; const result = await db.query(`INSERT INTO users (company_id, name, email, password_hash, role, phone_number) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, email, role, phone_number`, [companyId, name, email, passwordHash, role, formattedPhoneNumber]); res.status(201).json({ message: 'User created!', user: result.rows[0] }); } catch (error) { if (error.code === '23505') { return res.status(400).json({ message: 'Error: Email or phone number already in use.' }); } console.error('Error creating user:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.patch('/users/:id', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { id } = req.params; const { name, email, role, phoneNumber } = req.body; const { companyId } = req.user; const formattedPhoneNumber = phoneNumber ? `whatsapp:+${phoneNumber.replace(/[^0-9]/g, '')}` : null; const result = await db.query(`UPDATE users SET name = $1, email = $2, role = $3, phone_number = $4 WHERE id = $5 AND company_id = $6 RETURNING id, name, email, role, phone_number`, [name, email, role, formattedPhoneNumber, id, companyId]); if (result.rows.length === 0) { return res.status(404).json({ message: "User not found." }); } res.json({ message: 'User updated!', user: result.rows[0] }); } catch (error) { if (error.code === '23505') { return res.status(400).json({ message: 'Error: Email or phone number already in use.' }); } console.error('Error updating user:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.delete('/users/:id', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { id } = req.params; const { companyId, userId } = req.user; if (id == userId) { return res.status(403).json({ message: "You cannot delete your own account." }); } const result = await db.query('DELETE FROM users WHERE id = $1 AND company_id = $2', [id, companyId]); if (result.rowCount === 0) { return res.status(404).json({ message: "User not found." }); } res.status(200).json({ message: 'User deleted.' }); } catch (error) { console.error('Error deleting user:', error); res.status(500).json({ message: 'Internal server error' }); } });

// Machine Management
app.get('/machines', authenticateToken, authorize(ALL_ROLES), async (req, res) => { try { const { companyId } = req.user; const result = await db.query('SELECT * FROM machines WHERE company_id = $1 ORDER BY name ASC', [companyId]); res.json(result.rows); } catch (error) { console.error('Error fetching machines:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.post('/machines', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { name, location } = req.body; const { companyId } = req.user; const result = await db.query('INSERT INTO machines (company_id, name, location) VALUES ($1, $2, $3) RETURNING *', [companyId, name, location]); res.status(201).json({ message: 'Machine created!', machine: result.rows[0] }); } catch (error) { console.error('Error creating machine:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.patch('/machines/:id', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { id } = req.params; const { name, location } = req.body; const { companyId } = req.user; const result = await db.query('UPDATE machines SET name = $1, location = $2 WHERE id = $3 AND company_id = $4 RETURNING *', [name, location, id, companyId]); if (result.rows.length === 0) { return res.status(404).json({ message: 'Machine not found.' }); } res.json({ message: 'Machine updated!', machine: result.rows[0] }); } catch (error) { console.error('Error updating machine:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.delete('/machines/:id', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { id } = req.params; const { companyId } = req.user; const result = await db.query('DELETE FROM machines WHERE id = $1 AND company_id = $2', [id, companyId]); if (result.rowCount === 0) { return res.status(404).json({ message: 'Machine not found.' }); } res.status(200).json({ message: 'Machine deleted.' }); } catch (error) { if (error.code === '23503') { return res.status(400).json({ message: 'Cannot delete machine. It is linked to other records.' }); } console.error('Error deleting machine:', error); res.status(500).json({ message: 'Internal server error' }); } });

// ... and so on for all your other endpoints.

// --- SERVER STARTUP ---
app.listen(PORT, () => {
    // UPDATED: The new startup message from our test
    console.log(`>>>> BACKEND SERVER VERSION 2.0 IS RUNNING SUCCESSFULLY ON PORT ${PORT} <<<<`);
});