const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./db');
const cors = require('cors');
const twilio = require('twilio');
const cron = require('node-cron'); // Ensure node-cron is installed (npm install node-cron)
const { authenticateToken, authorize } = require('./middleware/authMiddleware');
const { sendBulkWhatsAppMessages } = require('./whatsappService'); // Assuming this exists and is correct for Twilio

const app = express();
const PORT = 4000;

// Middleware Setup
app.use(express.urlencoded({ extended: false })); // For Twilio webhooks
app.use(express.json()); // For API requests
app.use(cors()); // For allowing frontend access

// --- HELPER & BACKGROUND JOBS ---

async function sendBreakdownNotification(breakdownId, companyId) {
    console.log(`Sending notifications for new breakdown #${breakdownId}`);
    try {
        const breakdownInfo = await db.query(
            `SELECT b.id, b.description, m.name as machine_name, u.name as reporter_name
             FROM breakdowns b
             JOIN machines m ON b.machine_id = m.id
             JOIN users u ON b.reported_by_id = u.id
             WHERE b.id = $1`, [breakdownId]
        );
        if (breakdownInfo.rows.length === 0) {
            console.error(`Breakdown info not found for ID: ${breakdownId}`);
            return;
        }
        const { machine_name, description, reporter_name } = breakdownInfo.rows[0];

        const supervisors = await db.query(
            `SELECT id, phone_number FROM users WHERE company_id = $1 AND role IN ('Supervisor', 'Maintenance Manager')`,
            [companyId]
        );

        if (supervisors.rows.length === 0) {
            console.log("No supervisors/managers found to notify.");
            return;
        }

        const notificationMessage = `⚠️ New Breakdown Alert ⚠️\n\nMachine: ${machine_name}\nIssue: ${description}\nReported by: ${reporter_name}`;
        const messagesToSend = supervisors.rows
            .filter(s => s.phone_number)
            .map(s => ({
                to: s.phone_number.replace('whatsapp:+', ''), // Ensure correct format for sending service
                text: notificationMessage,
                recipientId: s.id
            }));

        if (messagesToSend.length > 0) {
            // NOTE: Ensure sendBulkWhatsAppMessages is correctly implemented for Twilio in whatsappService.js
            const sendResults = await sendBulkWhatsAppMessages(messagesToSend);
            for (const result of sendResults) {
                await db.query(
                    `INSERT INTO notification_logs (breakdown_id, recipient_id, recipient_phone_number, message_body, delivery_status) VALUES ($1, $2, $3, $4, $5)`,
                    [breakdownId, result.recipientId, `whatsapp:+${result.to}`, result.text, result.status] // Store with prefix
                );
            }
            console.log(`Successfully attempted to send ${sendResults.length} breakdown notifications.`);
        } else {
             console.log("No supervisors/managers with valid phone numbers found to notify.");
        }
    } catch (error) {
        console.error("Failed to send breakdown notifications:", error);
    }
}

// Simple endpoint for testing
app.get('/', (req, res) => { res.send('Your PlantMaint Pro server is running!'); });

// --- WHATSAPP WEBHOOK ---
app.post('/whatsapp', async (req, res) => {
    const twiml = new twilio.twiml.MessagingResponse();
    let responseMessage = "Sorry, an error occurred. Please try again later. Send 'cancel' to restart.";

    try {
        const from = req.body.From; // e.g., whatsapp:+1...
        const msg_body = req.body.Body.trim().toLowerCase();
        const recipientNumber = from.replace('whatsapp:+', ''); // For sending replies back
        console.log(`\n--- Incoming message from ${from}: "${msg_body}"`);

        const userResult = await db.query('SELECT * FROM users WHERE phone_number = $1', [from]);
        if (userResult.rows.length === 0) {
            responseMessage = "Sorry, your phone number is not registered in the system.";
        } else {
            const user = userResult.rows[0];
            const currentState = user.whatsapp_state || 'IDLE';
            let context = user.whatsapp_context || {};
            const userRole = user.role;

            const reset_words = ['hi', 'hello', 'menu', 'cancel', 'start'];

            if (reset_words.includes(msg_body) || currentState === 'IDLE') {
                let menuOptions = {};
                responseMessage = `Welcome ${user.name}. Please choose an option:\n`;
                context = {}; // Reset context

                if (userRole === 'Operator') {
                    menuOptions = { '1': { text: 'Report Breakdown', nextState: 'AWAITING_MACHINE_CHOICE_BREAKDOWN' }, '2': { text: 'Check Breakdown Status', nextState: 'AWAITING_STATUS_MACHINE_CHOICE' }, '3': { text: 'Report Breakdown Completion', nextState: 'AWAITING_COMPLETION_CHOICE' } };
                    responseMessage += "1. Report Breakdown\n2. Check Breakdown Status\n3. Report Breakdown Completion";
                } else if (userRole === 'Supervisor') {
                    menuOptions = { '1': { text: 'Check Breakdown Status', nextState: 'AWAITING_STATUS_MACHINE_CHOICE' }, '2': { text: 'Request Job Order', nextState: 'AWAITING_JOB_ORDER_MACHINE' }, '3': { text: 'Check Job Order Status', nextState: 'AWAITING_JOB_ORDER_ID_STATUS' } };
                     responseMessage += "1. Check Breakdown Status\n2. Request Job Order\n3. Check Job Order Status";
                } else if (userRole === 'Maintenance Technician') {
                     menuOptions = { '1': { text: 'Report Breakdown Completion', nextState: 'AWAITING_COMPLETION_CHOICE' }, '2': { text: 'Check Job Order Status', nextState: 'AWAITING_JOB_ORDER_ID_STATUS' }, '3': { text: 'Machine Inspection', nextState: 'AWAITING_INSPECTION_MACHINE' }, '4': { text: 'Check Breakdown Status', nextState: 'AWAITING_STATUS_MACHINE_CHOICE' }, '5': { text: 'Check PM Activities', nextState: 'PM_ACTIVITIES_LIST' }, '6': { text: 'Report PM Completion', nextState: 'AWAITING_PM_COMPLETION_CHOICE' } };
                     responseMessage += "1. Report Breakdown Completion\n2. Check Job Order Status\n3. Machine Inspection\n4. Check Breakdown Status\n5. Check PM Activities\n6. Report PM Completion";
                } else if (userRole === 'Maintenance Manager') {
                     menuOptions = { '1': { text: 'Check Breakdown Status', nextState: 'AWAITING_STATUS_MACHINE_CHOICE' }, '2': { text: 'Check Job Order Status', nextState: 'AWAITING_JOB_ORDER_ID_STATUS' }, '3': { text: 'Create Job Order', nextState: 'AWAITING_JOB_ORDER_MACHINE' }, '4': { text: 'Check PM Activities', nextState: 'PM_ACTIVITIES_LIST' }, '5': { text: 'Check KPIs', nextState: 'KPI_REPORT' } };
                     responseMessage += "1. Check Breakdown Status\n2. Check Job Order Status\n3. Create Job Order\n4. Check PM Activities\n5. Check KPIs";
                } else { // Default or 'Other Managers'
                     menuOptions = { '1': { text: 'Check Breakdown Status', nextState: 'AWAITING_STATUS_MACHINE_CHOICE' }, '2': { text: 'Check Job Order Status', nextState: 'AWAITING_JOB_ORDER_ID_STATUS' }, '3': { text: 'Check PM Activities', nextState: 'PM_ACTIVITIES_LIST' }, '4': { text: 'Check KPIs', nextState: 'KPI_REPORT' } };
                    responseMessage += "1. Check Breakdown Status\n2. Check Job Order Status\n3. Check PM Activities\n4. Check KPIs";
                }
                
                context.current_menu = menuOptions;
                await db.query("UPDATE users SET whatsapp_state = 'AWAITING_MENU_CHOICE', whatsapp_context = $1 WHERE id = $2", [context, user.id]);

            } else { // Continue existing conversation
                switch (currentState) {
                    case 'AWAITING_MENU_CHOICE':
                        const selectedOption = context.current_menu?.[msg_body];
                        if (selectedOption) {
                            if (['AWAITING_MACHINE_CHOICE_BREAKDOWN', 'AWAITING_STATUS_MACHINE_CHOICE', 'AWAITING_JOB_ORDER_MACHINE', 'AWAITING_INSPECTION_MACHINE'].includes(selectedOption.nextState)) {
                                const machinesResult = await db.query('SELECT id, name FROM machines WHERE company_id = $1 ORDER BY name ASC', [user.company_id]);
                                if (machinesResult.rows.length > 0) {
                                    let machineList = "";
                                    if(selectedOption.nextState === 'AWAITING_MACHINE_CHOICE_BREAKDOWN') machineList = "Please reply with the number for the machine that has broken down:\n";
                                    else if (selectedOption.nextState === 'AWAITING_STATUS_MACHINE_CHOICE') machineList = "Please select a machine to check its status:\n";
                                    else if (selectedOption.nextState === 'AWAITING_JOB_ORDER_MACHINE') machineList = "Please select a machine for the Job Order:\n";
                                    else if (selectedOption.nextState === 'AWAITING_INSPECTION_MACHINE') machineList = "Please select a machine to inspect:\n";

                                    context.machine_id_map = machinesResult.rows.map(m => m.id);
                                    machinesResult.rows.forEach((m, i) => { machineList += `${i + 1}. ${m.name}\n`; });
                                    responseMessage = machineList;
                                    await db.query("UPDATE users SET whatsapp_state = $1, whatsapp_context = $2 WHERE id = $3", [selectedOption.nextState, context, user.id]);
                                } else {
                                    responseMessage = "No machines are registered.";
                                    await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                                }
                            }
                            else if (selectedOption.nextState === 'AWAITING_COMPLETION_CHOICE') {
                                const openBreakdowns = await db.query(`SELECT b.id, m.name as machine_name FROM breakdowns b JOIN machines m ON b.machine_id = m.id WHERE b.company_id = $1 AND b.status = 'In Progress'`, [user.company_id]);
                                if (openBreakdowns.rows.length === 0) {
                                    responseMessage = "There are no breakdowns currently 'In Progress'.";
                                    await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                                } else {
                                    let breakdownList = "Which breakdown did you complete?\n";
                                    context.completion_map = openBreakdowns.rows.map(b => b.id);
                                    openBreakdowns.rows.forEach((b, i) => { breakdownList += `${i + 1}. ID #${b.id} (${b.machine_name})\n`; });
                                    responseMessage = breakdownList;
                                    await db.query("UPDATE users SET whatsapp_state = 'AWAITING_COMPLETION_CHOICE', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                                }
                            }
                            else if (selectedOption.nextState === 'AWAITING_JOB_ORDER_ID_STATUS') {
                                responseMessage = "Please reply with the Job Order ID number to check its status.";
                                await db.query("UPDATE users SET whatsapp_state = 'AWAITING_JOB_ORDER_ID_STATUS', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                            }
                            // Placeholder for features not yet built
                            else if (['PM_ACTIVITIES_LIST', 'KPI_REPORT', 'AWAITING_PM_COMPLETION_CHOICE'].includes(selectedOption.nextState)) {
                                 responseMessage = `You selected "${selectedOption.text}". This feature is under development.`;
                                 await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                            }
                            else { 
                                responseMessage = `Selected state "${selectedOption.nextState}" is not handled yet.`;
                                await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                            }
                        } else {
                            responseMessage = "Invalid option. Please reply with a number from the menu.\n";
                             if (context.current_menu) {
                                Object.entries(context.current_menu).forEach(([key, value]) => { responseMessage += `${key}. ${value.text}\n`; });
                             }
                        }
                        break; // End of AWAITING_MENU_CHOICE

                    case 'AWAITING_MACHINE_CHOICE_BREAKDOWN': 
                        const breakdownChoiceIndex = parseInt(msg_body, 10) - 1;
                        if (context.machine_id_map && breakdownChoiceIndex >= 0 && breakdownChoiceIndex < context.machine_id_map.length) {
                            context.selected_machine_id = context.machine_id_map[breakdownChoiceIndex];
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
                            responseMessage = "Invalid choice. Reply 1 for Electrical or 2 for Mechanical.";
                        }
                        break;

                    case 'AWAITING_DESCRIPTION':
                        const description = `${context.issue_type} Issue: ${req.body.Body.trim()}`; // Use original case
                        const machineId = context.selected_machine_id;
                        const newBreakdown = await db.query('INSERT INTO breakdowns (machine_id, company_id, reported_by_id, description) VALUES ($1, $2, $3, $4) RETURNING id', [machineId, user.company_id, user.id, description]);
                        const newBreakdownId = newBreakdown.rows[0].id;
                        responseMessage = `✅ Breakdown #${newBreakdownId} reported successfully. A team will be dispatched.`;
                        await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                        sendBreakdownNotification(newBreakdownId, user.company_id);
                        break;
                    
                    case 'AWAITING_STATUS_MACHINE_CHOICE':
                        const statusChoiceIndex = parseInt(msg_body, 10) - 1;
                        if (context.machine_id_map && statusChoiceIndex >= 0 && statusChoiceIndex < context.machine_id_map.length) {
                            const selectedMachineId = context.machine_id_map[statusChoiceIndex];
                            const breakdownResult = await db.query(`SELECT id, status, updated_at FROM breakdowns WHERE machine_id = $1 AND company_id = $2 ORDER BY reported_at DESC LIMIT 1`, [selectedMachineId, user.company_id]);
                            if (breakdownResult.rows.length === 0) {
                                responseMessage = "No breakdown reports found for this machine.";
                            } else {
                                const b = breakdownResult.rows[0];
                                const lastUpdated = b.updated_at ? new Date(b.updated_at).toLocaleString() : 'N/A';
                                responseMessage = `ℹ️ Latest status for Breakdown #${b.id} is: *${b.status}* (Last updated: ${lastUpdated})`;
                            }
                            await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                        } else {
                            responseMessage = "Invalid machine number. Please try again.";
                        }
                        break;

                     case 'AWAITING_COMPLETION_CHOICE':
                        const completionChoiceIndex = parseInt(msg_body, 10) - 1;
                        if (context.completion_map && completionChoiceIndex >= 0 && completionChoiceIndex < context.completion_map.length) {
                            context.breakdown_to_complete = context.completion_map[completionChoiceIndex];
                            // Check Role - Operators only confirm, Technicians provide details
                            if (userRole === 'Operator') {
                                responseMessage = "Is the work finished?\n1. Yes\n2. No";
                                await db.query("UPDATE users SET whatsapp_state = 'AWAITING_OPERATOR_CONFIRMATION', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                            } else if (userRole === 'Maintenance Technician') {
                                responseMessage = "Please provide a brief completion remark (e.g., 'Replaced faulty bearing').";
                                await db.query("UPDATE users SET whatsapp_state = 'AWAITING_COMPLETION_REMARK', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                            } else { // Default fallback for other roles trying this path
                                responseMessage = "Only Operators or Technicians can report completion this way.";
                                await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                            }
                        } else {
                            responseMessage = "Invalid selection. Please try again.";
                        }
                        break;

                    case 'AWAITING_COMPLETION_REMARK':
                        if (userRole === 'Maintenance Technician') {
                            context.completion_remark = req.body.Body.trim(); // Store original case remark
                            responseMessage = "Thank you. What was the root cause of the problem?";
                            await db.query("UPDATE users SET whatsapp_state = 'AWAITING_ROOT_CAUSE', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                        } else { // Should not happen, but reset if another role ends up here
                             responseMessage = "State error. Resetting. Send 'hi'.";
                             await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                        }
                        break;
                    // --- Technician Root Cause ---
                    case 'AWAITING_ROOT_CAUSE':
                         if (userRole === 'Maintenance Technician') {
                            context.root_cause = req.body.Body.trim();
                            responseMessage = "Was the root cause attended to?\n1. Yes\n2. No";
                            await db.query("UPDATE users SET whatsapp_state = 'AWAITING_ROOT_CAUSE_FIXED', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                        } else {
                             responseMessage = "State error. Resetting. Send 'hi'.";
                             await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                        }
                        break;

                    // --- Technician Root Cause Confirmation ---
                     case 'AWAITING_ROOT_CAUSE_FIXED':
                         if (userRole === 'Maintenance Technician') {
                            const breakdownIdToComplete = context.breakdown_to_complete;
                            const remark = context.completion_remark;
                            const rootCause = context.root_cause;
                            const rootCauseFixed = msg_body === '1'; // True if user replied '1'

                            let finalStatus = 'Resolved';
                            let descriptionUpdate = `\n\nCompletion Remark by ${user.name}: ${remark}\nRoot Cause: ${rootCause}`;
                            
                            if (!rootCauseFixed) {
                                // According to spec, keep breakdown open if root cause not fixed
                                // We might need a new status like 'Resolved - Root Cause Pending'
                                // For now, let's keep it 'Resolved' but add a note.
                                descriptionUpdate += "\n*Root cause was NOT attended to.*";
                                console.log(`LOG: Breakdown ${breakdownIdToComplete} resolved, but root cause pending.`);
                                // In a more complex system, we might create a new Job Order here.
                            } else {
                                descriptionUpdate += "\n*Root cause attended to.*";
                                console.log(`LOG: Breakdown ${breakdownIdToComplete} resolved, root cause fixed.`);
                            }

                            // Update the breakdown
                            await db.query(
                                `UPDATE breakdowns 
                                 SET status = $1, 
                                     description = description || $2, 
                                     resolved_at = NOW() 
                                 WHERE id = $3`,
                                [finalStatus, descriptionUpdate, breakdownIdToComplete]
                            );

                            // --- Notification Logic ---
                            const machineInfo = await db.query(`SELECT m.name as machine_name FROM machines m JOIN breakdowns b ON m.id = b.machine_id WHERE b.id = $1`, [breakdownIdToComplete]);
                            const machineName = machineInfo.rows.length > 0 ? machineInfo.rows[0].machine_name : 'Unknown Machine';
                            const supervisors = await db.query(`SELECT id, phone_number FROM users WHERE company_id = $1 AND role IN ('Supervisor', 'Maintenance Manager')`, [user.company_id]);
                            const originalReporterResult = await db.query(`SELECT u.id, u.phone_number FROM users u JOIN breakdowns b ON u.id = b.reported_by_id WHERE b.id = $1`, [breakdownIdToComplete]);

                            let messagesToSend = [];
                            const supervisorMessage = `✅ Breakdown #${breakdownIdToComplete} (${machineName}) has been marked as '${finalStatus}' by ${user.name}.${rootCauseFixed ? '' : ' Root cause pending.'}`;
                            supervisors.rows.forEach(s => { if (s.phone_number) messagesToSend.push({ to: s.phone_number.replace('whatsapp:+', ''), text: supervisorMessage, recipientId: s.id }); });
                            if (originalReporterResult.rows.length > 0 && originalReporterResult.rows[0].phone_number && originalReporterResult.rows[0].id !== user.id) {
                                const reporterMessage = `Update: The breakdown you reported for "${machineName}" (ID #${breakdownIdToComplete}) has been resolved${rootCauseFixed ? '.' : ' (root cause pending).'}`;
                                messagesToSend.push({ to: originalReporterResult.rows[0].phone_number.replace('whatsapp:+', ''), text: reporterMessage, recipientId: originalReporterResult.rows[0].id });
                            }
                            if (messagesToSend.length > 0) {
                                const sendResults = await sendBulkWhatsAppMessages(messagesToSend);
                                // Log results...
                            }
                            // --- End Notification Logic ---
                            
                            responseMessage = `Thank you. Breakdown #${breakdownIdToComplete} has been updated.`;
                            await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);

                        } else {
                             responseMessage = "State error. Resetting. Send 'hi'.";
                             await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                        }
                        break;
                        
                    // --- Operator Confirmation ---
                    case 'AWAITING_OPERATOR_CONFIRMATION':
                        if (userRole === 'Operator') {
                            const breakdownIdToConfirm = context.breakdown_to_complete;
                            if (msg_body === '1') { // Yes, work is finished
                                // Mark as 'Closed' - or maybe just 'Resolved' is enough? Let's use Resolved for now.
                                await db.query(`UPDATE breakdowns SET status = 'Resolved' WHERE id = $1`, [breakdownIdToConfirm]);
                                responseMessage = `Thank you for confirming completion of Breakdown #${breakdownIdToConfirm}.`;
                                // Notify manager/supervisor?
                            } else { // No, work is not finished
                                // What should happen? Maybe revert status? Notify supervisor?
                                // For now, just acknowledge.
                                responseMessage = `Okay, Breakdown #${breakdownIdToConfirm} status remains unchanged. Please inform your supervisor if there are issues.`;
                            }
                             await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                        } else {
                             responseMessage = "State error. Resetting. Send 'hi'.";
                             await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                        }
                        break;
                        
                     case 'AWAITING_JOB_ORDER_MACHINE':
                        const joMachineChoiceIndex = parseInt(msg_body, 10) - 1;
                        if (context.machine_id_map && joMachineChoiceIndex >= 0 && joMachineChoiceIndex < context.machine_id_map.length) {
                            context.selected_machine_id = context.machine_id_map[joMachineChoiceIndex];
                            responseMessage = "Please provide a brief description of the work to be done for this Job Order.";
                            await db.query("UPDATE users SET whatsapp_state = 'AWAITING_JOB_ORDER_DESCRIPTION', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                        } else {
                            responseMessage = "Invalid machine number. Please try again.";
                        }
                        break;

                    case 'AWAITING_JOB_ORDER_DESCRIPTION':
                        const joDescription = req.body.Body.trim(); // Use original case
                        const joMachineId = context.selected_machine_id;

                        const newJobOrder = await db.query(`INSERT INTO job_orders (machine_id, company_id, requested_by_id, description) VALUES ($1, $2, $3, $4) RETURNING id`, [joMachineId, user.company_id, user.id, joDescription]);
                        const newJobOrderId = newJobOrder.rows[0].id;

                        responseMessage = `✅ Job Order #${newJobOrderId} requested successfully. It will be reviewed by management.`;
                        await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                        // Add notification logic here later if needed (e.g., notify manager)
                        break;

                    case 'AWAITING_JOB_ORDER_ID_STATUS':
                        const jobOrderId = parseInt(msg_body, 10);
                        if (!jobOrderId) {
                            responseMessage = "Invalid ID. Please reply with the Job Order ID number.";
                        } else {
                            const jobOrderResult = await db.query(`SELECT jo.status, m.name as machine_name FROM job_orders jo JOIN machines m ON jo.machine_id = m.id WHERE jo.id = $1 AND jo.company_id = $2`, [jobOrderId, user.company_id]);
                            if (jobOrderResult.rows.length === 0) {
                                responseMessage = `Error: Job Order with ID ${jobOrderId} was not found.`;
                            } else {
                                const jo = jobOrderResult.rows[0];
                                responseMessage = `ℹ️ Status for Job Order #${jobOrderId} (${jo.machine_name}) is: *${jo.status}*`;
                            }
                            await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                        }
                        break;

                    default:
                        responseMessage = "Sorry, I got confused. Let's start over. Send 'hi' to begin.";
                        await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                        break;
                }
            }
        }
    } catch (error) {
        console.error("CRITICAL ERROR in /whatsapp endpoint:", error);
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

// Breakdown Management
app.get('/breakdowns', authenticateToken, authorize(ALL_ROLES), async (req, res) => { try { const { companyId } = req.user; const query = ` SELECT b.id, b.description, b.status, b.reported_at, m.name AS machine_name, m.location AS machine_location FROM breakdowns b JOIN machines m ON b.machine_id = m.id WHERE b.company_id = $1 AND b.status != 'Closed' ORDER BY b.reported_at ASC `; const result = await db.query(query, [companyId]); res.json(result.rows); } catch (error) { console.error('Error fetching breakdowns:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.post('/breakdowns', authenticateToken, authorize(ALL_ROLES), async (req, res) => { try { const { machineId, description } = req.body; const { userId, companyId } = req.user; const result = await db.query('INSERT INTO breakdowns (machine_id, company_id, reported_by_id, description) VALUES ($1, $2, $3, $4) RETURNING *', [machineId, companyId, userId, description]); const newBreakdown = result.rows[0]; sendBreakdownNotification(newBreakdown.id, companyId); res.status(201).json({ message: 'Breakdown reported!', breakdown: newBreakdown }); } catch (error) { console.error('Error reporting breakdown:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.patch('/breakdowns/:id/status', authenticateToken, authorize(MANAGER_AND_SUPERVISOR), async (req, res) => { try { const { id } = req.params; const { status } = req.body; const { companyId } = req.user; const result = await db.query( "UPDATE breakdowns SET status = $1 WHERE id = $2 AND company_id = $3 RETURNING *", [status, id, companyId] ); if (result.rows.length === 0) { return res.status(404).json({ message: 'Breakdown not found.' }); } res.json({ message: 'Status updated!', breakdown: result.rows[0] }); } catch (error) { console.error('Error updating status:', error); res.status(500).json({ message: 'Internal server error' }); } });

// Utility Management
app.get('/utilities', authenticateToken, authorize(ALL_ROLES), async (req, res) => { try { const { companyId } = req.user; const result = await db.query('SELECT * FROM utilities WHERE company_id = $1', [companyId]); res.json(result.rows); } catch (error) { console.error('Error fetching utilities:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.post('/utilities', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { name, unit } = req.body; const { companyId } = req.user; const result = await db.query('INSERT INTO utilities (company_id, name, unit) VALUES ($1, $2, $3) RETURNING *', [companyId, name, unit]); res.status(201).json({ message: 'Utility created!', utility: result.rows[0] }); } catch (error) { console.error('Error creating utility:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.post('/utility-readings', authenticateToken, authorize(ALL_ROLES), async (req, res) => { try { const { utilityId, readingValue } = req.body; const { userId, companyId } = req.user; const result = await db.query('INSERT INTO utility_readings (utility_id, company_id, recorded_by_id, reading_value) VALUES ($1, $2, $3, $4) RETURNING *', [utilityId, companyId, userId, readingValue]); res.status(201).json({ message: 'Reading submitted!', reading: result.rows[0] }); } catch (error) { console.error('Error submitting utility reading:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.get('/utilities/:utilityId/readings', authenticateToken, authorize(MANAGER_AND_SUPERVISOR), async (req, res) => { try { const { utilityId } = req.params; const { companyId } = req.user; const query = ` SELECT ur.id, ur.reading_value, ur.recorded_at, u.name as recorded_by_name FROM utility_readings ur JOIN users u ON ur.recorded_by_id = u.id WHERE ur.utility_id = $1 AND ur.company_id = $2 ORDER BY ur.recorded_at DESC `; const result = await db.query(query, [companyId]); res.json(result.rows); } catch (error) { console.error('Error fetching utility readings:', error); res.status(500).json({ message: 'Internal server error' }); } });

// Dashboard & Analytics
app.get('/dashboard/kpis', authenticateToken, authorize(MANAGER_AND_SUPERVISOR), async (req, res) => { try { const { companyId } = req.user; const activeBreakdownsQuery = "SELECT COUNT(*) FROM breakdowns WHERE company_id = $1 AND status NOT IN ('Resolved', 'Closed')"; const activeBreakdownsResult = await db.query(activeBreakdownsQuery, [companyId]); const machinesNeedingAttentionQuery = "SELECT COUNT(DISTINCT machine_id) FROM breakdowns WHERE company_id = $1 AND status NOT IN ('Resolved', 'Closed')"; const machinesNeedingAttentionResult = await db.query(machinesNeedingAttentionQuery, [companyId]); const kpis = { activeBreakdowns: parseInt(activeBreakdownsResult.rows[0].count, 10), machinesNeedingAttention: parseInt(machinesNeedingAttentionResult.rows[0].count, 10), }; res.json(kpis); } catch (error) { console.error('Error fetching KPIs:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.get('/charts/utility-consumption', authenticateToken, authorize(MANAGER_AND_SUPERVISOR), async (req, res) => { try { const { companyId } = req.user; const { utilityId, days } = req.query; const query = ` SELECT DATE_TRUNC('day', recorded_at AT TIME ZONE 'UTC') AS date, SUM(reading_value) AS "totalConsumption" FROM utility_readings WHERE utility_id = $1 AND company_id = $2 AND recorded_at >= NOW() - ($3 * INTERVAL '1 day') GROUP BY date ORDER BY date ASC `; const result = await db.query(query, [utilityId, companyId, days]); res.json(result.rows); } catch (error) { console.error('Error fetching chart data:', error); res.status(500).json({ message: 'Internal server error' }); } });

// Job Order Management
app.get('/job-orders', authenticateToken, authorize(MANAGER_AND_SUPERVISOR), async (req, res) => { try { const { companyId } = req.user; const query = `SELECT jo.*, m.name as machine_name, u_req.name as requested_by_name FROM job_orders jo JOIN machines m ON jo.machine_id = m.id JOIN users u_req ON jo.requested_by_id = u_req.id WHERE jo.company_id = $1 ORDER BY jo.requested_at DESC`; const result = await db.query(query, [companyId]); res.json(result.rows); } catch (error) { console.error('Error fetching job orders:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.post('/job-orders', authenticateToken, authorize(MANAGER_AND_SUPERVISOR), async (req, res) => { try { const { machineId, description } = req.body; const { userId, companyId } = req.user; const machineCheck = await db.query('SELECT id FROM machines WHERE id = $1 AND company_id = $2', [machineId, companyId]); if (machineCheck.rows.length === 0) { return res.status(404).json({ message: 'Machine not found.' }); } const result = await db.query(`INSERT INTO job_orders (machine_id, company_id, requested_by_id, description) VALUES ($1, $2, $3, $4) RETURNING *`, [machineId, companyId, userId, description]); res.status(201).json({ message: 'Job Order created!', jobOrder: result.rows[0] }); } catch (error) { console.error('Error creating job order:', error); res.status(500).json({ message: 'Internal server error' }); } });

// Preventive Maintenance
app.get('/preventive-maintenance', authenticateToken, authorize(MANAGER_AND_SUPERVISOR), async (req, res) => { try { const { companyId } = req.user; const query = ` SELECT pmt.*, m.name as machine_name FROM preventive_maintenance_tasks pmt JOIN machines m ON pmt.machine_id = m.id WHERE pmt.company_id = $1 ORDER BY pmt.next_due_date ASC `; const result = await db.query(query, [companyId]); res.json(result.rows); } catch (error) { console.error('Error fetching maintenance tasks:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.post('/preventive-maintenance', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { machineId, taskDescription, frequencyDays, startDate } = req.body; const { companyId } = req.user; const nextDueDate = new Date(startDate); const result = await db.query(`INSERT INTO preventive_maintenance_tasks (machine_id, company_id, task_description, frequency_days, next_due_date) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [machineId, companyId, taskDescription, frequencyDays, nextDueDate]); res.status(201).json({ message: 'Task scheduled!', task: result.rows[0] }); } catch (error) { console.error('Error scheduling task:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.patch('/preventive-maintenance/:id', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { id } = req.params; const { taskDescription, frequencyDays, next_due_date } = req.body; const { companyId } = req.user; const result = await db.query(`UPDATE preventive_maintenance_tasks SET task_description = $1, frequency_days = $2, next_due_date = $3 WHERE id = $4 AND company_id = $5 RETURNING *`, [taskDescription, frequencyDays, next_due_date, id, companyId]); if (result.rows.length === 0) { return res.status(404).json({ message: 'Task not found.' }); } const finalResult = await db.query(`SELECT pmt.*, m.name as machine_name FROM preventive_maintenance_tasks pmt JOIN machines m ON pmt.machine_id = m.id WHERE pmt.id = $1`, [id]); res.json({ message: 'Task updated!', task: finalResult.rows[0] }); } catch (error) { console.error('Error updating task:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.delete('/preventive-maintenance/:id', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { id } = req.params; const { companyId } = req.user; const result = await db.query('DELETE FROM preventive_maintenance_tasks WHERE id = $1 AND company_id = $2', [id, companyId]); if (result.rowCount === 0) { return res.status(404).json({ message: 'Task not found.' }); } res.status(200).json({ message: 'Task deleted.' }); } catch (error) { console.error('Error deleting task:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.post('/preventive-maintenance/:id/complete', authenticateToken, authorize(MANAGER_AND_SUPERVISOR), async (req, res) => { try { const { id } = req.params; const { companyId } = req.user; const taskRes = await db.query('SELECT frequency_days FROM preventive_maintenance_tasks WHERE id = $1 AND company_id = $2', [id, companyId]); if (taskRes.rows.length === 0) { return res.status(404).json({ message: 'Task not found.' }); } const { frequency_days } = taskRes.rows[0]; const query = ` UPDATE preventive_maintenance_tasks SET last_performed_at = NOW(), next_due_date = (NOW() + ($1 * INTERVAL '1 day'))::DATE WHERE id = $2 AND company_id = $3 RETURNING * `; const result = await db.query(query, [frequency_days, id, companyId]); const updatedTaskQuery = ` SELECT pmt.*, m.name as machine_name FROM preventive_maintenance_tasks pmt JOIN machines m ON pmt.machine_id = m.id WHERE pmt.id = $1 `; const finalResult = await db.query(updatedTaskQuery, [id]); res.json({ message: 'Task marked as complete!', task: finalResult.rows[0] }); } catch (error) { console.error('Error completing task:', error); res.status(500).json({ message: 'Internal server error' }); } });

// --- SERVER STARTUP ---
app.listen(PORT, () => {
  console.log(`>>>> BACKEND SERVER VERSION 2.0 IS RUNNING SUCCESSFULLY ON PORT ${PORT} <<<<`);
});