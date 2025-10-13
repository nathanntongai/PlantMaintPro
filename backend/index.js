const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./db');
const cors = require('cors');
const twilio = require('twilio');
const { authenticateToken, authorize } = require('./middleware/authMiddleware');

const app = express();
const PORT = 4000;

// Middleware Setup
// This is for Twilio webhooks
app.use(express.urlencoded({ extended: false }));
// This is for our JSON-based API
app.use(express.json());
// This allows the frontend to talk to the backend
app.use(cors());

// Simple endpoint for testing
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
                            machinesResult.rows.forEach((machine, index) => {
                                machineList += `${index + 1}. ${machine.name}\n`;
                            });
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

                    await db.query(
                        'INSERT INTO breakdowns (machine_id, company_id, reported_by_id, description) VALUES ($1, $2, $3, $4)',
                        [machineId, user.company_id, user.id, description]
                    );
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
// ... (Your /register and /login endpoints are here)
app.post('/register', async (req, res) => { /* ... */ });
app.post('/login', async (req, res) => { /* ... */ });

// --- PROTECTED API ENDPOINTS ---
const ALL_ROLES = ['Maintenance Manager', 'Supervisor', 'Maintenance Technician', 'Operator'];
const MANAGER_AND_SUPERVISOR = ['Maintenance Manager', 'Supervisor'];
const MANAGER_ONLY = ['Maintenance Manager'];

// ... (All other endpoints for Users, Machines, Breakdowns, Utilities, PM, etc., are here)

// --- SERVER STARTUP ---
app.listen(PORT, () => {
  console.log(`Server is running successfully on http://localhost:${PORT}`);
});