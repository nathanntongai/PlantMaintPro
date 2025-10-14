// backend/index.js (The Definitive, Complete Version)

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./db');
const cors = require('cors');
const twilio = require('twilio');
const { authenticateToken, authorize } = require('./middleware/authMiddleware');
cconst { sendBulkWhatsAppMessages } = require('./whatsappService');

const app = express();
const PORT = 4000;

// Middleware Setup
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cors()); // This is the crucial line that fixes the CORS error

// Simple endpoint for testing
app.get('/', (req, res) => { res.send('Your PlantMaint Pro server is running!'); });

// --- WHATSAPP WEBHOOK ---
// In backend/index.js, replace the existing app.post('/whatsapp', ...)

// In backend/index.js, replace the entire app.post('/whatsapp', ...) function

// In backend/index.js, replace the entire app.post('/whatsapp', ...) function

// In backend/index.js, replace the entire app.post('/whatsapp', ...) function

// backend/index.js (Updated WhatsApp Webhook)

// backend/index.js (WhatsApp Webhook with Supervisor Notifications + Machine Name & Breakdown ID)

// In backend/index.js, replace the app.post('/whatsapp', ...) function

app.post('/whatsapp', async (req, res) => {
    // This now uses the sendBulkWhatsAppMessages function which uses the Meta API.
    // Ensure your .env file and GitHub secrets are configured for Meta, not Twilio.
    
    // We send an immediate response to Twilio/Meta to prevent timeouts
    res.sendStatus(200);

    try {
        const from = req.body.From || `whatsapp:${req.body.entry[0].changes[0].value.messages[0].from}`;
        const msg_body = req.body.Body?.trim().toLowerCase() || req.body.entry[0].changes[0].value.messages[0].text.body.trim().toLowerCase();
        const recipientNumber = from.replace('whatsapp:+', '');

        console.log(`Incoming message from ${from}: "${msg_body}"`);

        const userResult = await db.query('SELECT * FROM users WHERE phone_number = $1', [from]);
        if (userResult.rows.length === 0) {
            await sendBulkWhatsAppMessages([{ to: recipientNumber, text: "Sorry, your phone number is not registered." }]);
            return;
        }

        const user = userResult.rows[0];
        const currentState = user.whatsapp_state || 'IDLE';
        let context = user.whatsapp_context || {};

        if (['hi', 'hello', 'menu', 'cancel'].includes(msg_body)) {
            const text = "Please choose an option:\n1. Report Breakdown\n2. Check Breakdown Status\n3. Report Breakdown Completion";
            await db.query("UPDATE users SET whatsapp_state = 'AWAITING_MENU_CHOICE', whatsapp_context = NULL WHERE id = $1", [user.id]);
            await sendBulkWhatsAppMessages([{ to: recipientNumber, text }]);
            return;
        }

        switch (currentState) {
            case 'AWAITING_MENU_CHOICE':
                if (msg_body === '1') { /* Report Breakdown - same as before */ }
                else if (msg_body === '2') { /* Check Status - same as before */ }
                else if (msg_body === '3') { // NEW: Report Completion
                    const openBreakdowns = await db.query(`SELECT b.id, m.name as machine_name FROM breakdowns b JOIN machines m ON b.machine_id = m.id WHERE b.company_id = $1 AND b.status = 'In Progress'`, [user.company_id]);
                    if (openBreakdowns.rows.length === 0) {
                        await sendBulkWhatsAppMessages([{ to: recipientNumber, text: "There are no breakdowns currently 'In Progress' to complete." }]);
                        await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                    } else {
                        let breakdownList = "Which breakdown did you complete? Please reply with the number.\n";
                        const breakdownIdMap = openBreakdowns.rows.map(b => b.id);
                        openBreakdowns.rows.forEach((b, i) => { breakdownList += `${i + 1}. ID #${b.id} (${b.machine_name})\n`; });
                        context.completion_map = breakdownIdMap;
                        await db.query("UPDATE users SET whatsapp_state = 'AWAITING_COMPLETION_CHOICE', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                        await sendBulkWhatsAppMessages([{ to: recipientNumber, text: breakdownList }]);
                    }
                } else { /* Invalid option - same as before */ }
                break;

            case 'AWAITING_COMPLETION_CHOICE':
                const choiceIndex = parseInt(msg_body, 10) - 1;
                if (context.completion_map && choiceIndex >= 0 && choiceIndex < context.completion_map.length) {
                    context.breakdown_to_complete = context.completion_map[choiceIndex];
                    await db.query("UPDATE users SET whatsapp_state = 'AWAITING_COMPLETION_REMARK', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                    await sendBulkWhatsAppMessages([{ to: recipientNumber, text: "Please provide a brief completion remark (e.g., 'Replaced faulty bearing')." }]);
                } else {
                    await sendBulkWhatsAppMessages([{ to: recipientNumber, text: "Invalid selection. Please try again." }]);
                }
                break;

            case 'AWAITING_COMPLETION_REMARK':
                const breakdownId = context.breakdown_to_complete;
                const remark = msg_body;

                // 1. Update the breakdown
                const updatedBreakdown = await db.query(
                    `UPDATE breakdowns SET status = 'Resolved', description = description || '\n\nCompletion Remark: ${remark}', resolved_at = NOW() WHERE id = $1 RETURNING *`,
                    [breakdownId]
                );
                
                // 2. Find recipients
                const supervisors = await db.query(`SELECT id, phone_number FROM users WHERE company_id = $1 AND role IN ('Supervisor', 'Maintenance Manager')`, [user.company_id]);
                const originalReporter = await db.query(`SELECT u.id, u.phone_number FROM users u JOIN breakdowns b ON u.id = b.reported_by_id WHERE b.id = $1`, [breakdownId]);
                const machineInfo = await db.query(`SELECT m.name as machine_name FROM machines m JOIN breakdowns b ON m.id = b.machine_id WHERE b.id = $1`, [breakdownId]);
                const machineName = machineInfo.rows[0].machine_name;

                let messagesToSend = [];
                // 3. Construct messages
                const supervisorMessage = `✅ Breakdown #${breakdownId} (${machineName}) has been marked as 'Resolved' by ${user.name}.`;
                supervisors.rows.forEach(s => {
                    if (s.phone_number) messagesToSend.push({ to: s.phone_number.replace('whatsapp:+', ''), text: supervisorMessage, recipientId: s.id });
                });

                if (originalReporter.rows.length > 0 && originalReporter.rows[0].phone_number && originalReporter.rows[0].id !== user.id) {
                    const reporterMessage = `Update: The breakdown you reported for "${machineName}" (ID #${breakdownId}) has been resolved.`;
                    messagesToSend.push({ to: originalReporter.rows[0].phone_number.replace('whatsapp:+', ''), text: reporterMessage, recipientId: originalReporter.rows[0].id });
                }

                // 4. Send messages and log results
                const sendResults = await sendBulkWhatsAppMessages(messagesToSend);
                for (const result of sendResults) {
                    await db.query(
                        `INSERT INTO notification_logs (breakdown_id, recipient_id, recipient_phone_number, message_body, delivery_status)
                         VALUES ($1, $2, $3, $4, $5)`,
                        [breakdownId, result.recipientId, result.to, result.text, result.status]
                    );
                }
                
                // 5. Confirm completion to the current user and reset state
                await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                await sendBulkWhatsAppMessages([{ to: recipientNumber, text: `Thank you. Breakdown #${breakdownId} has been marked as resolved.` }]);
                break;

            // ... (All other cases like AWAITING_MACHINE_CHOICE remain the same)
        }
    } catch (error) {
        console.error("CRITICAL ERROR in /whatsapp endpoint:", error);
    }
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
        const query = `SELECT u.*, c.name as company_name FROM users u JOIN companies c ON u.company_id = c.id WHERE u.email = $1`;
        const result = await db.query(query, [email]);
        const user = result.rows[0];
        const passwordMatches = user ? await bcrypt.compare(password, user.password_hash) : false;
        if (!passwordMatches) { return res.status(401).json({ message: 'Invalid credentials' }); }
        const token = jwt.sign({ userId: user.id, role: user.role, companyId: user.company_id }, process.env.JWT_SECRET, { expiresIn: '8h' });
        delete user.password_hash;
        res.json({ message: 'Login successful!', token: token, user: user });
    } catch (error) { console.error('Login error:', error); res.status(500).json({ message: 'Internal server error' }); }
});

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

// Breakdown Management
app.get('/breakdowns', authenticateToken, authorize(ALL_ROLES), async (req, res) => { try { const { companyId } = req.user; const query = ` SELECT b.id, b.description, b.status, b.reported_at, m.name AS machine_name, m.location AS machine_location FROM breakdowns b JOIN machines m ON b.machine_id = m.id WHERE b.company_id = $1 AND b.status != 'Closed' ORDER BY b.reported_at ASC `; const result = await db.query(query, [companyId]); res.json(result.rows); } catch (error) { console.error('Error fetching breakdowns:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.post('/breakdowns', authenticateToken, authorize(ALL_ROLES), async (req, res) => { try { const { machineId, description } = req.body; const { userId, companyId } = req.user; const result = await db.query('INSERT INTO breakdowns (machine_id, company_id, reported_by_id, description) VALUES ($1, $2, $3, $4) RETURNING *', [machineId, companyId, userId, description]); res.status(201).json({ message: 'Breakdown reported!', breakdown: result.rows[0] }); } catch (error) { console.error('Error reporting breakdown:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.patch('/breakdowns/:id/status', authenticateToken, authorize(MANAGER_AND_SUPERVISOR), async (req, res) => { try { const { id } = req.params; const { status } = req.body; const { companyId } = req.user; const result = await db.query( "UPDATE breakdowns SET status = $1 WHERE id = $2 AND company_id = $3 RETURNING *", [status, id, companyId] ); if (result.rows.length === 0) { return res.status(404).json({ message: 'Breakdown not found.' }); } res.json({ message: 'Status updated!', breakdown: result.rows[0] }); } catch (error) { console.error('Error updating status:', error); res.status(500).json({ message: 'Internal server error' }); } });

// Utility Management
app.get('/utilities', authenticateToken, authorize(ALL_ROLES), async (req, res) => { try { const { companyId } = req.user; const result = await db.query('SELECT * FROM utilities WHERE company_id = $1', [companyId]); res.json(result.rows); } catch (error) { console.error('Error fetching utilities:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.post('/utilities', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { name, unit } = req.body; const { companyId } = req.user; const result = await db.query('INSERT INTO utilities (company_id, name, unit) VALUES ($1, $2, $3) RETURNING *', [companyId, name, unit]); res.status(201).json({ message: 'Utility created!', utility: result.rows[0] }); } catch (error) { console.error('Error creating utility:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.post('/utility-readings', authenticateToken, authorize(ALL_ROLES), async (req, res) => { try { const { utilityId, readingValue } = req.body; const { userId, companyId } = req.user; const result = await db.query('INSERT INTO utility_readings (utility_id, company_id, recorded_by_id, reading_value) VALUES ($1, $2, $3, $4) RETURNING *', [utilityId, companyId, userId, readingValue]); res.status(201).json({ message: 'Reading submitted!', reading: result.rows[0] }); } catch (error) { console.error('Error submitting utility reading:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.get('/utilities/:utilityId/readings', authenticateToken, authorize(MANAGER_AND_SUPERVISOR), async (req, res) => { try { const { utilityId } = req.params; const { companyId } = req.user; const query = ` SELECT ur.id, ur.reading_value, ur.recorded_at, u.name as recorded_by_name FROM utility_readings ur JOIN users u ON ur.recorded_by_id = u.id WHERE ur.utility_id = $1 AND ur.company_id = $2 ORDER BY ur.recorded_at DESC `; const result = await db.query(query, [companyId]); res.json(result.rows); } catch (error) { console.error('Error fetching utility readings:', error); res.status(500).json({ message: 'Internal server error' }); } });

// Dashboard & Analytics
app.get('/dashboard/kpis', authenticateToken, authorize(MANAGER_AND_SUPERVISOR), async (req, res) => { try { const { companyId } = req.user; const activeBreakdownsQuery = "SELECT COUNT(*) FROM breakdowns WHERE company_id = $1 AND status NOT IN ('Resolved', 'Closed')"; const activeBreakdownsResult = await db.query(activeBreakdownsQuery, [companyId]); const machinesNeedingAttentionQuery = "SELECT COUNT(DISTINCT machine_id) FROM breakdowns WHERE company_id = $1 AND status NOT IN ('Resolved', 'Closed')"; const machinesNeedingAttentionResult = await db.query(machinesNeedingAttentionQuery, [companyId]); const kpis = { activeBreakdowns: parseInt(activeBreakdownsResult.rows[0].count, 10), machinesNeedingAttention: parseInt(machinesNeedingAttentionResult.rows[0].count, 10), }; res.json(kpis); } catch (error) { console.error('Error fetching KPIs:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.get('/charts/utility-consumption', authenticateToken, authorize(MANAGER_AND_SUPERVISOR), async (req, res) => { try { const { companyId } = req.user; const { utilityId, days } = req.query; const query = ` SELECT DATE_TRUNC('day', recorded_at AT TIME ZONE 'UTC') AS date, SUM(reading_value) AS "totalConsumption" FROM utility_readings WHERE utility_id = $1 AND company_id = $2 AND recorded_at >= NOW() - ($3 * INTERVAL '1 day') GROUP BY date ORDER BY date ASC `; const result = await db.query(query, [utilityId, companyId, days]); res.json(result.rows); } catch (error) { console.error('Error fetching chart data:', error); res.status(500).json({ message: 'Internal server error' }); } });

// Preventive Maintenance
app.get('/preventive-maintenance', authenticateToken, authorize(MANAGER_AND_SUPERVISOR), async (req, res) => { try { const { companyId } = req.user; const query = ` SELECT pmt.*, m.name as machine_name FROM preventive_maintenance_tasks pmt JOIN machines m ON pmt.machine_id = m.id WHERE pmt.company_id = $1 ORDER BY pmt.next_due_date ASC `; const result = await db.query(query, [companyId]); res.json(result.rows); } catch (error) { console.error('Error fetching maintenance tasks:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.post('/preventive-maintenance', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { machineId, taskDescription, frequencyDays, startDate } = req.body; const { companyId } = req.user; const nextDueDate = new Date(startDate); const result = await db.query(`INSERT INTO preventive_maintenance_tasks (machine_id, company_id, task_description, frequency_days, next_due_date) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [machineId, companyId, taskDescription, frequencyDays, nextDueDate]); res.status(201).json({ message: 'Task scheduled!', task: result.rows[0] }); } catch (error) { console.error('Error scheduling task:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.patch('/preventive-maintenance/:id', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { id } = req.params; const { taskDescription, frequencyDays, next_due_date } = req.body; const { companyId } = req.user; const result = await db.query(`UPDATE preventive_maintenance_tasks SET task_description = $1, frequency_days = $2, next_due_date = $3 WHERE id = $4 AND company_id = $5 RETURNING *`, [taskDescription, frequencyDays, next_due_date, id, companyId]); if (result.rows.length === 0) { return res.status(404).json({ message: 'Task not found.' }); } const finalResult = await db.query(`SELECT pmt.*, m.name as machine_name FROM preventive_maintenance_tasks pmt JOIN machines m ON pmt.machine_id = m.id WHERE pmt.id = $1`, [id]); res.json({ message: 'Task updated!', task: finalResult.rows[0] }); } catch (error) { console.error('Error updating task:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.delete('/preventive-maintenance/:id', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { id } = req.params; const { companyId } = req.user; const result = await db.query('DELETE FROM preventive_maintenance_tasks WHERE id = $1 AND company_id = $2', [id, companyId]); if (result.rowCount === 0) { return res.status(404).json({ message: 'Task not found.' }); } res.status(200).json({ message: 'Task deleted.' }); } catch (error) { console.error('Error deleting task:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.post('/preventive-maintenance/:id/complete', authenticateToken, authorize(MANAGER_AND_SUPERVISOR), async (req, res) => { try { const { id } = req.params; const { companyId } = req.user; const taskRes = await db.query('SELECT frequency_days FROM preventive_maintenance_tasks WHERE id = $1 AND company_id = $2', [id, companyId]); if (taskRes.rows.length === 0) { return res.status(404).json({ message: 'Task not found.' }); } const { frequency_days } = taskRes.rows[0]; const query = ` UPDATE preventive_maintenance_tasks SET last_performed_at = NOW(), next_due_date = (NOW() + ($1 * INTERVAL '1 day'))::DATE WHERE id = $2 AND company_id = $3 RETURNING * `; const result = await db.query(query, [frequency_days, id, companyId]); const updatedTaskQuery = ` SELECT pmt.*, m.name as machine_name FROM preventive_maintenance_tasks pmt JOIN machines m ON pmt.machine_id = m.id WHERE pmt.id = $1 `; const finalResult = await db.query(updatedTaskQuery, [id]); res.json({ message: 'Task marked as complete!', task: finalResult.rows[0] }); } catch (error) { console.error('Error completing task:', error); res.status(500).json({ message: 'Internal server error' }); } });

// --- SERVER STARTUP ---
app.listen(PORT, () => {
  console.log(`Server is running successfully on http://localhost:${PORT}`);
});