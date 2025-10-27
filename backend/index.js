const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./db');
const cors = require('cors');
const twilio = require('twilio');
const cron = require('node-cron');
const excel = require('exceljs');
const multer = require('multer');
const { authenticateToken, authorize } = require('./middleware/authMiddleware');
const { sendBulkWhatsAppMessages } = require('./whatsappService');

const app = express();
const PORT = 4000;

// Middleware Setup
app.use(express.urlencoded({ extended: false })); // For Twilio webhooks
app.use(express.json()); // For API requests
app.use(cors()); // For allowing frontend access
// Configure Multer for in-memory file storage
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// --- HELPER & BACKGROUND JOBS ---

async function sendBreakdownApprovalRequest(breakdownId, companyId) {
    console.log(`Sending approval request for breakdown #${breakdownId}`);
    try {
        const breakdownInfo = await db.query(
            `SELECT b.id, b.description, m.name as machine_name, u.name as reporter_name
             FROM breakdowns b
             JOIN machines m ON b.machine_id = m.id
             JOIN users u ON b.reported_by_id = u.id
             WHERE b.id = $1`, [breakdownId]
        );
        if (breakdownInfo.rows.length === 0) {
            console.error(`Breakdown info not found for ID: ${breakdownId} during approval request.`);
            return;
        }
        const { machine_name, description, reporter_name } = breakdownInfo.rows[0];

        const supervisors = await db.query(
            `SELECT id, phone_number FROM users WHERE company_id = $1 AND role IN ('Supervisor', 'Maintenance Manager')`,
            [companyId]
        );

        if (supervisors.rows.length === 0) {
            console.log("No supervisors/managers found to request approval from.");
            return;
        }

        const approvalMessage = `⚠️ Breakdown Reported (#${breakdownId}) ⚠️\nMachine: ${machine_name}\nIssue: ${description}\nReported by: ${reporter_name}\n\nPlease reply with:\nApprove ${breakdownId}\nDisapprove ${breakdownId}`;

        const messagesToSend = supervisors.rows
            .filter(s => s.phone_number)
            .map(s => ({
                to: s.phone_number.replace('whatsapp:+', ''),
                text: approvalMessage,
                recipientId: s.id
            }));

        if (messagesToSend.length > 0) {
            const sendResults = await sendBulkWhatsAppMessages(messagesToSend);
            for (const result of sendResults) {
                await db.query(
                    `INSERT INTO notification_logs (breakdown_id, recipient_id, recipient_phone_number, message_body, delivery_status) VALUES ($1, $2, $3, $4, $5)`,
                    [breakdownId, result.recipientId, `whatsapp:+${result.to}`, result.text, result.status]
                );
            }
            console.log(`Successfully attempted to send ${sendResults.length} approval requests.`);
        } else {
             console.log("No supervisors/managers with valid phone numbers found for approval request.");
        }
    } catch (error) {
        console.error("Failed to send breakdown approval requests:", error);
    }
}

async function notifyTechniciansAndManager(breakdownId, companyId, approverName) {
     console.log(`Sending assignment notification for approved breakdown #${breakdownId}`);
     try {
         const breakdownInfo = await db.query(
            `SELECT b.id, b.description, m.name as machine_name
             FROM breakdowns b
             JOIN machines m ON b.machine_id = m.id
             WHERE b.id = $1`, [breakdownId]
         );
         if (breakdownInfo.rows.length === 0) {
             console.error(`Breakdown info not found for ID: ${breakdownId} during technician notification.`);
             return;
         }
         const { machine_name, description } = breakdownInfo.rows[0];

         const recipients = await db.query(
             `SELECT id, phone_number FROM users WHERE company_id = $1 AND role IN ('Maintenance Technician', 'Maintenance Manager')`,
             [companyId]
         );

         if (recipients.rows.length === 0) {
             console.log("No technicians or managers found to notify about approval.");
             return;
         }

         const notificationMessage = `🛠️ Breakdown #${breakdownId} Approved 🛠️\n\nMachine: ${machine_name}\nIssue: ${description}\nApproved by: ${approverName}\n\nPlease reply with 'ACK ${breakdownId}' to acknowledge and accept this job.`;
         
         const messagesToSend = recipients.rows
             .filter(r => r.phone_number)
             .map(r => ({
                 to: r.phone_number.replace('whatsapp:+', ''),
                 text: notificationMessage,
                 recipientId: r.id
             }));

         if (messagesToSend.length > 0) {
            const sendResults = await sendBulkWhatsAppMessages(messagesToSend);
            for (const result of sendResults) {
                await db.query(
                    `INSERT INTO notification_logs (breakdown_id, recipient_id, recipient_phone_number, message_body, delivery_status) VALUES ($1, $2, $3, $4, $5)`,
                    [breakdownId, result.recipientId, `whatsapp:+${result.to}`, result.text, result.status]
                );
            }
            console.log(`Successfully attempted to send ${sendResults.length} approval notifications.`);
         } else {
              console.log("No technicians/managers with valid phone numbers found for approval notification.");
         }
     } catch(error) {
          console.error("Failed to send approval notifications:", error);
     }
}

// Simple endpoint for testing
app.get('/', (req, res) => { res.send('Your PlantMaint Pro server is running!'); });

// --- WHATSAPP WEBHOOK ---
app.post('/whatsapp', async (req, res) => {
    // Respond immediately to Twilio to prevent timeouts
    const twiml = new twilio.twiml.MessagingResponse();
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml.toString());

    // --- Process message asynchronously ---
    try {
        const from = req.body.From; // e.g., whatsapp:+1...
        const msg_body = req.body.Body.trim().toLowerCase();
        const recipientNumber = from.replace('whatsapp:+', ''); // For sending replies back
        console.log(`\n--- Incoming message from ${from}: "${msg_body}"`);

        const userResult = await db.query('SELECT * FROM users WHERE phone_number = $1', [from]);
        if (userResult.rows.length === 0) {
             await sendBulkWhatsAppMessages([{ to: recipientNumber, text: "Sorry, your phone number is not registered." }]);
             return;
        }

        const user = userResult.rows[0];
        const currentState = user.whatsapp_state || 'IDLE';
        let context = user.whatsapp_context || {};
        const userRole = user.role;
        let finalResponseMessage = null; // Use this to send reply at the end

        // --- Approval/Disapproval Command Check (runs regardless of state) ---
        const approvalMatch = msg_body.match(/^(approve|disapprove)\s+(\d+)$/);
        
        // --- Acknowledgment Command Check (runs regardless of state) ---
        const ackMatch = msg_body.match(/^(ack|acknowledge)\s+(\d+)$/);

        // --- Manager Acknowledgment Command Check (runs regardless of state) ---
        const ackBreakdownMatch = msg_body.match(/^(ack-b)\s+(\d+)$/);

        if (approvalMatch && ['Supervisor', 'Maintenance Manager'].includes(userRole)) {
             console.log("DEBUG: Matched approval/disapproval command.");
             const action = approvalMatch[1]; // 'approve' or 'disapprove'
             const breakdownIdToUpdate = parseInt(approvalMatch[2], 10);
             const newStatus = action === 'approve' ? 'Reported' : 'Closed'; // Disapproved = Closed
             console.log(`DEBUG: Attempting to ${action} breakdown ${breakdownIdToUpdate} to status ${newStatus}`);

             const statusUpdate = await db.query(
                 `UPDATE breakdowns SET status = $1, approved_by_id = $2 WHERE id = $3 AND company_id = $4 AND status = 'Pending Approval' RETURNING id`,
                 [newStatus, user.id, breakdownIdToUpdate, user.company_id]
             );
             console.log("DEBUG: Database update query executed.");

             if (statusUpdate.rowCount > 0) {
                 console.log(`DEBUG: Update successful for breakdown ${breakdownIdToUpdate}`);
                 finalResponseMessage = `Breakdown #${breakdownIdToUpdate} has been ${action}d.`;
                 if (action === 'approve') {
                     console.log("DEBUG: Triggering technician/manager notification.");
                     notifyTechniciansAndManager(breakdownIdToUpdate, user.company_id, user.name);
                 }
             } else {
                 console.log(`DEBUG: Failed to update breakdown ${breakdownIdToUpdate}. Row count was 0.`);
                 finalResponseMessage = `Could not ${action} Breakdown #${breakdownIdToUpdate}. It might already be processed or does not exist.`;
             }
             console.log("DEBUG: Resetting user state to IDLE after approval/disapproval.");
             await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
        
        } else if (ackMatch && userRole === 'Maintenance Technician') {
            console.log("DEBUG: Matched acknowledgment command.");
            const breakdownIdToAck = parseInt(ackMatch[2], 10);

            const currentBreakdown = await db.query(
                `SELECT status, assigned_to_id FROM breakdowns WHERE id = $1 AND company_id = $2`,
                [breakdownIdToAck, user.company_id]
            );

            if (currentBreakdown.rows.length === 0) {
                finalResponseMessage = `Breakdown #${breakdownIdToAck} was not found.`;
            } else if (currentBreakdown.rows[0].status !== 'Reported') {
                finalResponseMessage = `Breakdown #${breakdownIdToAck} has already been acknowledged or is in progress.`;
            } else {
                await db.query(
                    `UPDATE breakdowns SET status = 'Acknowledged', assigned_to_id = $1 WHERE id = $2`,
                    [user.id, breakdownIdToAck]
                );
                finalResponseMessage = `✅ You have acknowledged Breakdown #${breakdownIdToAck}. Status updated to 'Acknowledged'.`;
                
                const managers = await db.query(
                    `SELECT id, phone_number FROM users WHERE company_id = $1 AND role IN ('Supervisor', 'Maintenance Manager')`,
                    [user.company_id]
                );
                const managerMessage = `ℹ️ Update: Breakdown #${breakdownIdToAck} has been acknowledged by ${user.name}.`;
                const messagesToSend = managers.rows
                    .filter(m => m.phone_number)
                    .map(m => ({ to: m.phone_number.replace('whatsapp:+', ''), text: managerMessage, recipientId: m.id }));
                
                if (messagesToSend.length > 0) {
                    sendBulkWhatsAppMessages(messagesToSend); // Send in background
                }
            }
            await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
        
        } else if (ackBreakdownMatch && ['Supervisor', 'Maintenance Manager'].includes(userRole)) {
            console.log("DEBUG: Matched manager breakdown acknowledgment command.");
            const breakdownIdToAck = parseInt(ackBreakdownMatch[2], 10);
            
            const ackUpdate = await db.query(
                `UPDATE breakdowns SET manager_acknowledged_at = NOW() 
                 WHERE id = $1 AND company_id = $2 AND status = 'Resolved' AND manager_acknowledged_at IS NULL RETURNING id`,
                [breakdownIdToAck, user.company_id]
            );

            if (ackUpdate.rowCount > 0) {
                finalResponseMessage = `✅ Completion of Breakdown #${breakdownIdToAck} has been acknowledged.`;
            } else {
                finalResponseMessage = `Could not acknowledge Breakdown #${breakdownIdToAck}. It may already be acknowledged or not yet resolved.`;
            }
            await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);

        } else { // --- Standard Conversational Flow ---
            const reset_words = ['hi', 'hello', 'menu', 'cancel', 'start'];
            if (reset_words.includes(msg_body) || currentState === 'IDLE') {
                console.log("DEBUG: Resetting conversation to main menu.");
                let menuOptions = {};
                finalResponseMessage = `Welcome ${user.name}. Please choose an option:\n`;
                context = {};

                if (userRole === 'Operator') {
                    menuOptions = { '1': { text: 'Report Breakdown', nextState: 'AWAITING_MACHINE_CHOICE_BREAKDOWN' }, '2': { text: 'Check Breakdown Status', nextState: 'AWAITING_STATUS_MACHINE_CHOICE' }, '3': { text: 'Report Breakdown Completion', nextState: 'AWAITING_COMPLETION_CHOICE' } };
                    finalResponseMessage += "1. Report Breakdown\n2. Check Breakdown Status\n3. Report Breakdown Completion";
                } else if (userRole === 'Supervisor') {
                    menuOptions = { '1': { text: 'Check Breakdown Status', nextState: 'AWAITING_STATUS_MACHINE_CHOICE' }, '2': { text: 'Request Job Order', nextState: 'AWAITING_JOB_ORDER_MACHINE' }, '3': { text: 'Check Job Order Status', nextState: 'AWAITING_JOB_ORDER_ID_STATUS' } };
                     finalResponseMessage += "1. Check Breakdown Status\n2. Request Job Order\n3. Check Job Order Status";
                } else if (userRole === 'Maintenance Technician') {
                     menuOptions = { '1': { text: 'Report Breakdown Completion', nextState: 'AWAITING_COMPLETION_CHOICE' }, '2': { text: 'Check Job Order Status', nextState: 'AWAITING_JOB_ORDER_ID_STATUS' }, '3': { text: 'Machine Inspection', nextState: 'AWAITING_INSPECTION_MACHINE' }, '4': { text: 'Check Breakdown Status', nextState: 'AWAITING_STATUS_MACHINE_CHOICE' }, '5': { text: 'Check PM Activities', nextState: 'PM_ACTIVITIES_LIST' }, '6': { text: 'Report PM Completion', nextState: 'AWAITING_PM_COMPLETION_CHOICE' } };
                     finalResponseMessage += "1. Report Breakdown Completion\n2. Check Job Order Status\n3. Machine Inspection\n4. Check Breakdown Status\n5. Check PM Activities\n6. Report PM Completion";
                } else if (userRole === 'Maintenance Manager') {
                     menuOptions = { '1': { text: 'Check Breakdown Status', nextState: 'AWAITING_STATUS_MACHINE_CHOICE' }, '2': { text: 'Check Job Order Status', nextState: 'AWAITING_JOB_ORDER_ID_STATUS' }, '3': { text: 'Create Job Order', nextState: 'AWAITING_JOB_ORDER_MACHINE' }, '4': { text: 'Check PM Activities', nextState: 'PM_ACTIVITIES_LIST' }, '5': { text: 'Check KPIs', nextState: 'KPI_REPORT' } };
                     finalResponseMessage += "1. Check Breakdown Status\n2. Check Job Order Status\n3. Create Job Order\n4. Check PM Activities\n5. Check KPIs";
                } else {
                     menuOptions = { '1': { text: 'Check Breakdown Status', nextState: 'AWAITING_STATUS_MACHINE_CHOICE' }, '2': { text: 'Check Job Order Status', nextState: 'AWAITING_JOB_ORDER_ID_STATUS' }, '3': { text: 'Check PM Activities', nextState: 'PM_ACTIVITIES_LIST' }, '4': { text: 'Check KPIs', nextState: 'KPI_REPORT' } };
                    finalResponseMessage += "1. Check Breakdown Status\n2. Check Job Order Status\n3. Check PM Activities\n4. Check KPIs";
                }
                
                context.current_menu = menuOptions;
                await db.query("UPDATE users SET whatsapp_state = 'AWAITING_MENU_CHOICE', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                console.log("DEBUG: User state set to AWAITING_MENU_CHOICE.");

            } else { // Continue existing conversation
                 console.log(`DEBUG: Continuing conversation in state: ${currentState}`);
                 switch (currentState) {
                    case 'AWAITING_MENU_CHOICE':
                        const selectedOption = context.current_menu?.[msg_body];
                        if (selectedOption) {
                            console.log(`DEBUG: User selected menu option: ${selectedOption.text}`);
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
                                    finalResponseMessage = machineList;
                                    await db.query("UPDATE users SET whatsapp_state = $1, whatsapp_context = $2 WHERE id = $3", [selectedOption.nextState, context, user.id]);
                                } else {
                                    finalResponseMessage = "No machines are registered.";
                                    await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                                }
                            }
                            else if (selectedOption.nextState === 'AWAITING_COMPLETION_CHOICE') {
                                const openBreakdowns = await db.query(`SELECT b.id, m.name as machine_name FROM breakdowns b JOIN machines m ON b.machine_id = m.id WHERE b.company_id = $1 AND b.status = 'In Progress'`, [user.company_id]);
                                if (openBreakdowns.rows.length === 0) {
                                    finalResponseMessage = "There are no breakdowns currently 'In Progress'.";
                                    await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                                } else {
                                    let breakdownList = "Which breakdown did you complete?\n";
                                    context.completion_map = openBreakdowns.rows.map(b => b.id);
                                    openBreakdowns.rows.forEach((b, i) => { breakdownList += `${i + 1}. ID #${b.id} (${b.machine_name})\n`; });
                                    finalResponseMessage = breakdownList;
                                    await db.query("UPDATE users SET whatsapp_state = 'AWAITING_COMPLETION_CHOICE', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                                }
                            }
                            else if (selectedOption.nextState === 'AWAITING_JOB_ORDER_ID_STATUS') {
                                finalResponseMessage = "Please reply with the Job Order ID number to check its status.";
                                await db.query("UPDATE users SET whatsapp_state = 'AWAITING_JOB_ORDER_ID_STATUS', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                            }
                            else if (selectedOption.nextState === 'PM_ACTIVITIES_LIST') {
                                const pmTasks = await db.query(
                                    `SELECT pmt.task_description, pmt.next_due_date, m.name as machine_name
                                     FROM preventive_maintenance_tasks pmt
                                     JOIN machines m ON pmt.machine_id = m.id
                                     WHERE pmt.company_id = $1 AND pmt.next_due_date <= (CURRENT_DATE + INTERVAL '7 days')
                                     ORDER BY pmt.next_due_date ASC`,
                                    [user.company_id]
                                );
                                if (pmTasks.rows.length === 0) {
                                    finalResponseMessage = "No Preventive Maintenance tasks are due in the next 7 days.";
                                } else {
                                    finalResponseMessage = "Upcoming PM Tasks (Next 7 Days):\n\n";
                                    pmTasks.rows.forEach(task => {
                                        finalResponseMessage += `*${new Date(task.next_due_date).toLocaleDateString()}* - ${task.machine_name}:\n  ${task.task_description}\n\n`;
                                    });
                                }
                                await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                            }
                            else if (selectedOption.nextState === 'KPI_REPORT') {
                                const kpiResult = await db.query(
                                    `SELECT 
                                        COUNT(*) AS total_breakdowns,
                                        SUM(CASE WHEN status = 'Resolved' THEN (resolved_at - reported_at) ELSE NULL END) AS total_downtime_interval
                                     FROM breakdowns
                                     WHERE company_id = $1 AND reported_at >= NOW() - INTERVAL '30 days'`,
                                    [user.company_id]
                                );
                                const kpis = kpiResult.rows[0];
                                const totalBreakdowns = kpis.total_breakdowns || 0;
                                let totalDowntime = "0 hours";
                                if (kpis.total_downtime_interval) {
                                    const d = kpis.total_downtime_interval;
                                    const hours = (d.days || 0) * 24 + (d.hours || 0);
                                    const minutes = d.minutes || 0;
                                    totalDowntime = `${hours} hours, ${minutes} minutes`;
                                }
                                finalResponseMessage = `KPI Report (Last 30 Days):\n\n`;
                                finalResponseMessage += `*Total Breakdowns:* ${totalBreakdowns}\n`;
                                finalResponseMessage += `*Total Downtime:* ${totalDowntime}\n`;
                                await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                            }
                            else if (selectedOption.nextState === 'AWAITING_PM_COMPLETION_CHOICE') {
                                const duePmTasks = await db.query(
                                    `SELECT pmt.id, pmt.task_description, m.name as machine_name 
                                     FROM preventive_maintenance_tasks pmt
                                     JOIN machines m ON pmt.machine_id = m.id
                                     WHERE pmt.company_id = $1 AND pmt.next_due_date <= CURRENT_DATE`,
                                    [user.company_id]
                                );
                                if (duePmTasks.rows.length === 0) {
                                    finalResponseMessage = "There are no Preventive Maintenance tasks currently due for completion.";
                                    await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                                } else {
                                    let taskList = "Which PM task did you complete? Please reply with the number.\n";
                                    context.pm_task_map = duePmTasks.rows.map(task => task.id);
                                    duePmTasks.rows.forEach((task, i) => {
                                        taskList += `${i + 1}. ${task.machine_name}: ${task.task_description}\n`;
                                    });
                                    finalResponseMessage = taskList;
                                    await db.query("UPDATE users SET whatsapp_state = 'AWAITING_PM_TASK_SELECTION', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                                }
                            }
                            else {
                                finalResponseMessage = `Selected state "${selectedOption.nextState}" is not handled yet.`;
                                await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                            }
                        } else {
                            finalResponseMessage = "Invalid option. Please reply with a number from the menu.\n";
                             if (context.current_menu) {
                                Object.entries(context.current_menu).forEach(([key, value]) => { finalResponseMessage += `${key}. ${value.text}\n`; });
                             }
                        }
                        break; // End of AWAITING_MENU_CHOICE

                    case 'AWAITING_MACHINE_CHOICE_BREAKDOWN':
                        const breakdownChoiceIndex = parseInt(msg_body, 10) - 1;
                        if (context.machine_id_map && breakdownChoiceIndex >= 0 && breakdownChoiceIndex < context.machine_id_map.length) {
                            context.selected_machine_id = context.machine_id_map[breakdownChoiceIndex];
                            finalResponseMessage = "Is the issue:\n1. Electrical\n2. Mechanical";
                            await db.query("UPDATE users SET whatsapp_state = 'AWAITING_ISSUE_TYPE', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                        } else {
                            finalResponseMessage = "Invalid machine number. Please try again.";
                        }
                        break;
                    
                    case 'AWAITING_ISSUE_TYPE':
                        let issueType = '';
                        if (msg_body === '1') issueType = 'Electrical';
                        if (msg_body === '2') issueType = 'Mechanical';
                        if (issueType) {
                            context.issue_type = issueType;
                            finalResponseMessage = "Thank you. Please provide a brief description of the issue.";
                            await db.query("UPDATE users SET whatsapp_state = 'AWAITING_DESCRIPTION', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                        } else {
                            finalResponseMessage = "Invalid choice. Reply 1 for Electrical or 2 for Mechanical.";
                        }
                        break;

                    case 'AWAITING_DESCRIPTION':
                        const description = `${context.issue_type} Issue: ${req.body.Body.trim()}`; // Use original case
                        const machineId = context.selected_machine_id;
                        const newBreakdown = await db.query('INSERT INTO breakdowns (machine_id, company_id, reported_by_id, description) VALUES ($1, $2, $3, $4) RETURNING id', [machineId, user.company_id, user.id, description]);
                        const newBreakdownId = newBreakdown.rows[0].id;
                        finalResponseMessage = `✅ Breakdown #${newBreakdownId} submitted for approval.`;
                        await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                        sendBreakdownApprovalRequest(newBreakdownId, user.company_id);
                        break;
                    
                    case 'AWAITING_STATUS_MACHINE_CHOICE':
                        const statusChoiceIndex = parseInt(msg_body, 10) - 1;
                        if (context.machine_id_map && statusChoiceIndex >= 0 && statusChoiceIndex < context.machine_id_map.length) {
                            const selectedMachineId = context.machine_id_map[statusChoiceIndex];
                            const breakdownResult = await db.query(`SELECT id, status, updated_at FROM breakdowns WHERE machine_id = $1 AND company_id = $2 ORDER BY reported_at DESC LIMIT 1`, [selectedMachineId, user.company_id]);
                            if (breakdownResult.rows.length === 0) {
                                finalResponseMessage = "No breakdown reports found for this machine.";
                            } else {
                                const b = breakdownResult.rows[0];
                                const lastUpdated = b.updated_at ? new Date(b.updated_at).toLocaleString() : 'N/A';
                                finalResponseMessage = `ℹ️ Latest status for Breakdown #${b.id} is: *${b.status}* (Last updated: ${lastUpdated})`;
                            }
                            await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                        } else {
                            finalResponseMessage = "Invalid machine number. Please try again.";
                        }
                        break;

                     case 'AWAITING_COMPLETION_CHOICE':
                        const completionChoiceIndex = parseInt(msg_body, 10) - 1;
                        if (context.completion_map && completionChoiceIndex >= 0 && completionChoiceIndex < context.completion_map.length) {
                            context.breakdown_to_complete = context.completion_map[completionChoiceIndex];
                            if (userRole === 'Operator') {
                                finalResponseMessage = "Is the work finished?\n1. Yes\n2. No";
                                await db.query("UPDATE users SET whatsapp_state = 'AWAITING_OPERATOR_CONFIRMATION', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                            } else if (userRole === 'Maintenance Technician') {
                                finalResponseMessage = "Please provide a brief completion remark (e.g., 'Replaced faulty bearing').";
                                await db.query("UPDATE users SET whatsapp_state = 'AWAITING_COMPLETION_REMARK', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                            } else {
                                finalResponseMessage = "Only Operators or Technicians can report completion this way.";
                                await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                            }
                        } else {
                            finalResponseMessage = "Invalid selection. Please try again.";
                        }
                        break;

                    case 'AWAITING_OPERATOR_CONFIRMATION':
                        if (userRole === 'Operator') {
                            const breakdownIdToConfirm = context.breakdown_to_complete;
                            if (msg_body === '1') { // Yes
                                await db.query(`UPDATE breakdowns SET status = 'Resolved' WHERE id = $1`, [breakdownIdToConfirm]);
                                finalResponseMessage = `Thank you for confirming completion of Breakdown #${breakdownIdToConfirm}.`;
                            } else { // No
                                finalResponseMessage = `Okay, Breakdown #${breakdownIdToConfirm} status remains unchanged. Please inform your supervisor.`;
                            }
                             await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                        } else {
                             finalResponseMessage = "State error. Resetting. Send 'hi'.";
                             await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                        }
                        break;

                    case 'AWAITING_COMPLETION_REMARK':
                        if (userRole === 'Maintenance Technician') {
                            context.completion_remark = req.body.Body.trim();
                            finalResponseMessage = "Thank you. What was the root cause of the problem?";
                            await db.query("UPDATE users SET whatsapp_state = 'AWAITING_ROOT_CAUSE', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                        } else {
                             finalResponseMessage = "State error. Resetting. Send 'hi'.";
                             await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                        }
                        break;

                    case 'AWAITING_ROOT_CAUSE':
                         if (userRole === 'Maintenance Technician') {
                            context.root_cause = req.body.Body.trim();
                            finalResponseMessage = "Was the root cause attended to?\n1. Yes\n2. No";
                            await db.query("UPDATE users SET whatsapp_state = 'AWAITING_ROOT_CAUSE_FIXED', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                        } else {
                             finalResponseMessage = "State error. Resetting. Send 'hi'.";
                             await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                        }
                        break;

                     case 'AWAITING_ROOT_CAUSE_FIXED':
                         if (userRole === 'Maintenance Technician') {
                            const breakdownIdToComplete = context.breakdown_to_complete;
                            const remark = context.completion_remark;
                            const rootCause = context.root_cause;
                            const rootCauseFixed = msg_body === '1';
                            let finalStatus = 'Resolved';
                            let descriptionUpdate = `\n\nCompletion Remark by ${user.name}: ${remark}\nRoot Cause: ${rootCause}`;
                            
                            const machineInfo = await db.query(`SELECT machine_id FROM breakdowns WHERE id = $1`, [breakdownIdToComplete]);
                            const completedMachineId = machineInfo.rows[0].machine_id;

                            if (!rootCauseFixed) {
                                descriptionUpdate += "\n*Root cause was NOT attended to.*";
                                console.log(`LOG: Breakdown ${breakdownIdToComplete} resolved, but root cause pending.`);
                                const jobOrderDescription = `Root cause from Breakdown #${breakdownIdToComplete}: ${rootCause}`;
                                await db.query(`INSERT INTO job_orders (machine_id, company_id, requested_by_id, description) VALUES ($1, $2, $3, $4)`, [completedMachineId, user.company_id, user.id, jobOrderDescription]);
                            } else {
                                descriptionUpdate += "\n*Root cause attended to.*";
                                console.log(`LOG: Breakdown ${breakdownIdToComplete} resolved, root cause fixed.`);
                            }
                            await db.query(`UPDATE breakdowns SET status = $1, description = description || $2, resolved_at = NOW() WHERE id = $3`, [finalStatus, descriptionUpdate, breakdownIdToComplete]);

                            // Notification Logic
                            const machineNameResult = await db.query(`SELECT name as machine_name FROM machines WHERE id = $1`, [completedMachineId]);
                            const machineName = machineNameResult.rows.length > 0 ? machineNameResult.rows[0].machine_name : 'Unknown Machine';
                            const supervisors = await db.query(`SELECT id, phone_number FROM users WHERE company_id = $1 AND role IN ('Supervisor', 'Maintenance Manager')`, [user.company_id]);
                            const originalReporterResult = await db.query(`SELECT u.id, u.phone_number FROM users u JOIN breakdowns b ON u.id = b.reported_by_id WHERE b.id = $1`, [breakdownIdToComplete]);
                            let messagesToSend = [];
                            const supervisorMessage = `✅ Breakdown #${breakdownIdToComplete} (${machineName}) has been marked as '${finalStatus}' by ${user.name}.${rootCauseFixed ? '' : ' Root cause pending.'}\n\nPlease reply 'ack-b ${breakdownIdToComplete}' to acknowledge.`;
                            supervisors.rows.forEach(s => { if (s.phone_number) messagesToSend.push({ to: s.phone_number.replace('whatsapp:+', ''), text: supervisorMessage, recipientId: s.id }); });
                            if (originalReporterResult.rows.length > 0 && originalReporterResult.rows[0].phone_number && originalReporterResult.rows[0].id !== user.id) {
                                const reporterMessage = `Update: The breakdown you reported for "${machineName}" (ID #${breakdownIdToComplete}) has been resolved${rootCauseFixed ? '.' : ' (root cause pending).'}`;
                                messagesToSend.push({ to: originalReporterResult.rows[0].phone_number.replace('whatsapp:+', ''), text: reporterMessage, recipientId: originalReporterResult.rows[0].id });
                            }
                            if (messagesToSend.length > 0) { sendBulkWhatsAppMessages(messagesToSend); }
                            
                            finalResponseMessage = `Thank you. Breakdown #${breakdownIdToComplete} has been updated.`;
                            await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);

                        } else {
                             finalResponseMessage = "State error. Resetting. Send 'hi'.";
                             await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                        }
                        break;

                    case 'AWAITING_JOB_ORDER_MACHINE':
                        const joMachineChoiceIndex = parseInt(msg_body, 10) - 1;
                        if (context.machine_id_map && joMachineChoiceIndex >= 0 && joMachineChoiceIndex < context.machine_id_map.length) {
                            context.selected_machine_id = context.machine_id_map[joMachineChoiceIndex];
                            finalResponseMessage = "Please provide a brief description of the work to be done for this Job Order.";
                            await db.query("UPDATE users SET whatsapp_state = 'AWAITING_JOB_ORDER_DESCRIPTION', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                        } else {
                            finalResponseMessage = "Invalid machine number. Please try again.";
                        }
                        break;

                    case 'AWAITING_JOB_ORDER_DESCRIPTION':
                        const joDescription = req.body.Body.trim();
                        const joMachineId = context.selected_machine_id;
                        if (!joDescription) {
                            finalResponseMessage = "Description cannot be empty. Please provide a description.";
                        } else if (!joMachineId) {
                             finalResponseMessage = "Machine selection lost. Please start over. Send 'cancel'.";
                             await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                        } else {
                            const newJobOrder = await db.query(`INSERT INTO job_orders (machine_id, company_id, requested_by_id, description) VALUES ($1, $2, $3, $4) RETURNING id`, [joMachineId, user.company_id, user.id, joDescription]);
                            const newJobOrderId = newJobOrder.rows[0].id;
                            finalResponseMessage = `✅ Job Order #${newJobOrderId} requested successfully. It will be reviewed by management.`;
                            await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                        }
                        break;

                    case 'AWAITING_JOB_ORDER_ID_STATUS':
                        const jobOrderId = parseInt(msg_body, 10);
                        if (!jobOrderId) {
                            finalResponseMessage = "Invalid ID. Please reply with the Job Order ID number.";
                        } else {
                            const jobOrderResult = await db.query(`SELECT jo.status, m.name as machine_name FROM job_orders jo JOIN machines m ON jo.machine_id = m.id WHERE jo.id = $1 AND jo.company_id = $2`, [jobOrderId, user.company_id]);
                            if (jobOrderResult.rows.length === 0) {
                                finalResponseMessage = `Error: Job Order with ID ${jobOrderId} was not found.`;
                            } else {
                                const jo = jobOrderResult.rows[0];
                                finalResponseMessage = `ℹ️ Status for Job Order #${jobOrderId} (${jo.machine_name}) is: *${jo.status}*`;
                            }
                            await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                        }
                        break;
                    
                    case 'AWAITING_INSPECTION_MACHINE':
                        const inspectionChoiceIndex = parseInt(msg_body, 10) - 1;
                        if (context.machine_id_map && inspectionChoiceIndex >= 0 && inspectionChoiceIndex < context.machine_id_map.length) {
                            context.selected_machine_id = context.machine_id_map[inspectionChoiceIndex];
                            finalResponseMessage = "Is the machine status:\n1. Okay\n2. Not Okay";
                            await db.query("UPDATE users SET whatsapp_state = 'AWAITING_INSPECTION_STATUS', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                        } else {
                            finalResponseMessage = "Invalid machine number. Please try again.";
                        }
                        break;
                    
                    case 'AWAITING_INSPECTION_STATUS':
                        const inspMachineId = context.selected_machine_id;
                        if (msg_body === '1') { // Okay
                            await db.query(`INSERT INTO machine_inspections (machine_id, company_id, inspected_by_id, status, remarks) VALUES ($1, $2, $3, 'Okay', 'Machine checked and found to be in good condition.')`, [inspMachineId, user.company_id, user.id]);
                            finalResponseMessage = `Inspection for machine ID #${inspMachineId} logged as 'Okay'.\n\nSend 'hi' to start over.`;
                            await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                        } else if (msg_body === '2') { // Not Okay
                            finalResponseMessage = "Please provide a brief description of the problem you observed.";
                            await db.query("UPDATE users SET whatsapp_state = 'AWAITING_INSPECTION_REMARKS', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                        } else {
                            finalResponseMessage = "Invalid choice. Please reply with 1 for 'Okay' or 2 for 'Not Okay'.";
                        }
                        break;
                    
                    case 'AWAITING_INSPECTION_REMARKS':
                        const inspMachineIdRemarks = context.selected_machine_id;
                        const inspectionRemarks = req.body.Body.trim(); // Get original case
                        await db.query(`INSERT INTO machine_inspections (machine_id, company_id, inspected_by_id, status, remarks) VALUES ($1, $2, $3, 'Not Okay', $4)`, [inspMachineIdRemarks, user.company_id, user.id, inspectionRemarks]);
                        finalResponseMessage = `Inspection for machine ID #${inspMachineIdRemarks} logged as 'Not Okay'. Thank you.\n\nSend 'hi' to start over.`;
                        await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                        break;

                    case 'AWAITING_PM_TASK_SELECTION':
                        const pmChoiceIndex = parseInt(msg_body, 10) - 1;
                        if (context.pm_task_map && pmChoiceIndex >= 0 && pmChoiceIndex < context.pm_task_map.length) {
                            const taskIdToComplete = context.pm_task_map[pmChoiceIndex];
                            
                            const taskRes = await db.query('SELECT frequency_days FROM preventive_maintenance_tasks WHERE id = $1 AND company_id = $2', [taskIdToComplete, user.company_id]);
                            if (taskRes.rows.length === 0) {
                                finalResponseMessage = "Task not found. Please start over.";
                            } else {
                                const { frequency_days } = taskRes.rows[0];
                                const query = ` UPDATE preventive_maintenance_tasks SET last_performed_at = NOW(), next_due_date = (NOW() + ($1 * INTERVAL '1 day'))::DATE WHERE id = $2 RETURNING * `;
                                await db.query(query, [frequency_days, taskIdToComplete]);
                                finalResponseMessage = `✅ PM Task #${taskIdToComplete} has been marked as complete. The next task is scheduled.`;
                            }
                            await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                        } else {
                            finalResponseMessage = "Invalid task number. Please try again.";
                        }
                        break;

                    default:
                        finalResponseMessage = "Sorry, I got confused. Let's start over. Send 'hi' to begin.";
                        await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                        break;
                }
            }
        }
        
         if (finalResponseMessage) {
             console.log(`DEBUG: Sending TwiML response: ${finalResponseMessage.replace(/\n/g, " ")}`);
             await sendBulkWhatsAppMessages([{ to: recipientNumber, text: finalResponseMessage }]);
         }

    } catch (error) {
        console.error("CRITICAL ERROR in /whatsapp endpoint:", error);
         try {
             const from = req.body.From;
             if (from) {
                 const recipientNumber = from.replace('whatsapp:+', '');
                 await sendBulkWhatsAppMessages([{ to: recipientNumber, text: "Sorry, a critical error occurred. Please try again." }]);
             }
         } catch (notifyError) {
             console.error("Failed to send error notification:", notifyError);
         }
    }
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
app.get('/templates/users', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const workbook = new excel.Workbook(); const worksheet = workbook.addWorksheet('Users'); worksheet.columns = [ { header: 'Full Name (Required)', key: 'name', width: 30 }, { header: 'Email (Required)', key: 'email', width: 30 }, { header: 'Initial Password (Required)', key: 'password', width: 30 }, { header: 'Role (Required)', key: 'role', width: 25 }, { header: 'Phone Number (Optional, e.g., 254...)', key: 'phone', width: 25, numFmt: '@' } ]; worksheet.dataValidations.add('D2:D1000', { type: 'list', allowBlank: false, formulae: ['"Maintenance Manager,Supervisor,Maintenance Technician,Operator"'], showErrorMessage: true, errorTitle: 'Invalid Role', error: 'Please select a valid role from the dropdown list' }); const instructionsSheet = workbook.addWorksheet('Instructions'); instructionsSheet.mergeCells('A1:B5'); instructionsSheet.getCell('A1').value = 'Instructions:\n1. Do not change the column headers in the "Users" sheet.\n2. All columns are required except for Phone Number.\n3. For the "Role" column, please select a value from the dropdown list.\n4. Phone Number must include the country code (e.g., 254...)'; instructionsSheet.getCell('A1').alignment = { wrapText: true, vertical: 'top' }; res.setHeader( 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ); res.setHeader( 'Content-Disposition', 'attachment; filename="users_template.xlsx"' ); await workbook.xlsx.write(res); res.end(); } catch (error) { console.error('Error generating user template:', error); res.status(500).json({ message: 'Error generating template' }); } });
app.post('/users/upload', authenticateToken, authorize(MANAGER_ONLY), upload.single('file'), async (req, res) => { if (!req.file) { return res.status(400).json({ message: 'No file uploaded.' }); } const { companyId } = req.user; const workbook = new excel.Workbook(); try { await workbook.xlsx.load(req.file.buffer); const worksheet = workbook.getWorksheet('Users'); if (!worksheet) { return res.status(400).json({ message: 'Invalid template: "Users" worksheet not found.' }); } let addedCount = 0; let errorCount = 0; let errors = []; const newUsers = []; const saltRounds = 10; for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) { const row = worksheet.getRow(rowNumber); const name = row.getCell('A').value; const emailCell = row.getCell('B').value; const email = (emailCell && typeof emailCell === 'object' && emailCell.text) ? emailCell.text : emailCell; const password = row.getCell('C').value; const role = row.getCell('D').value; const phoneNumber = row.getCell('E').value; if (!name || !email || !password || !role) { console.error(`Row ${rowNumber}: Skipping row due to missing required fields.`); errors.push(`Row ${rowNumber}: Missing required fields.`); errorCount++; continue; } try { const passwordHash = await bcrypt.hash(password.toString(), saltRounds); const formattedPhoneNumber = phoneNumber ? `whatsapp:+${phoneNumber.toString().replace(/[^0-9]/g, '')}` : null; const result = await db.query( `INSERT INTO users (company_id, name, email, password_hash, role, phone_number) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, email, role, phone_number`, [companyId, name, email, passwordHash, role, formattedPhoneNumber] ); newUsers.push(result.rows[0]); addedCount++; } catch (err) { console.error(`Row ${rowNumber}: Failed to insert user "${email}":`, err.message); errors.push(`Row ${rowNumber} (${email}): ${err.message}`); errorCount++; } } res.status(201).json({ message: `Upload complete: ${addedCount} users added, ${errorCount} rows failed.`, newUsers: newUsers, errors: errors }); } catch (error) { console.error('Error processing Excel file:', error); res.status(500).json({ message: 'Error processing file.' }); } });
app.patch('/users/:id', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { id } = req.params; const { name, email, role, phoneNumber } = req.body; const { companyId } = req.user; const formattedPhoneNumber = phoneNumber ? `whatsapp:+${phoneNumber.replace(/[^0-9]/g, '')}` : null; const result = await db.query(`UPDATE users SET name = $1, email = $2, role = $3, phone_number = $4 WHERE id = $5 AND company_id = $6 RETURNING id, name, email, role, phone_number`, [name, email, role, formattedPhoneNumber, id, companyId]); if (result.rows.length === 0) { return res.status(404).json({ message: "User not found." }); } res.json({ message: 'User updated!', user: result.rows[0] }); } catch (error) { if (error.code === '23505') { return res.status(400).json({ message: 'Error: Email or phone number already in use.' }); } console.error('Error updating user:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.delete('/users/:id', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { id } = req.params; const { companyId, userId } = req.user; if (id == userId) { return res.status(403).json({ message: "You cannot delete your own account." }); } const result = await db.query('DELETE FROM users WHERE id = $1 AND company_id = $2', [id, companyId]); if (result.rowCount === 0) { return res.status(404).json({ message: "User not found." }); } res.status(200).json({ message: 'User deleted.' }); } catch (error) { console.error('Error deleting user:', error); res.status(500).json({ message: 'Internal server error' }); } });

// Machine Management
app.get('/machines', authenticateToken, authorize(ALL_ROLES), async (req, res) => { try { const { companyId } = req.user; const result = await db.query('SELECT * FROM machines WHERE company_id = $1 ORDER BY name ASC', [companyId]); res.json(result.rows); } catch (error) { console.error('Error fetching machines:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.get('/templates/equipment', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const workbook = new excel.Workbook(); const worksheet = workbook.addWorksheet('Equipment'); worksheet.columns = [ { header: 'Machine Name (Required)', key: 'name', width: 30 }, { header: 'Location (Optional)', key: 'location', width: 30 } ]; const instructionsSheet = workbook.addWorksheet('Instructions'); instructionsSheet.mergeCells('A1:B5'); instructionsSheet.getCell('A1').value = 'Instructions:\n1. Do not change the column headers in the "Equipment" sheet.\n2. "Machine Name" is required for every row.\n3. "Location" is optional.\n4. Save this file and upload it on the "Equipment" page.'; instructionsSheet.getCell('A1').alignment = { wrapText: true, vertical: 'top' }; res.setHeader( 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ); res.setHeader( 'Content-Disposition', 'attachment; filename="equipment_template.xlsx"' ); await workbook.xlsx.write(res); res.end(); } catch (error) { console.error('Error generating equipment template:', error); res.status(500).json({ message: 'Error generating template' }); } });
app.post('/machines/upload', authenticateToken, authorize(MANAGER_ONLY), upload.single('file'), async (req, res) => { if (!req.file) { return res.status(400).json({ message: 'No file uploaded.' }); } const { companyId } = req.user; const workbook = new excel.Workbook(); try { await workbook.xlsx.load(req.file.buffer); const worksheet = workbook.getWorksheet('Equipment'); if (!worksheet) { return res.status(400).json({ message: 'Invalid template: "Equipment" worksheet not found.' }); } let addedCount = 0; let errorCount = 0; const newMachines = []; for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) { const row = worksheet.getRow(rowNumber); const machineName = row.getCell('A').value; const location = row.getCell('B').value || null; if (machineName) { try { const result = await db.query( 'INSERT INTO machines (company_id, name, location) VALUES ($1, $2, $3) RETURNING *', [companyId, machineName, location] ); newMachines.push(result.rows[0]); addedCount++; } catch (err) { console.error(`Failed to insert machine "${machineName}":`, err.message); errorCount++; } } } res.status(201).json({ message: `Upload complete: ${addedCount} machines added, ${errorCount} rows failed.`, newMachines: newMachines }); } catch (error) { console.error('Error processing Excel file:', error); res.status(500).json({ message: 'Error processing file.' }); } });
app.post('/machines', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { name, location } = req.body; const { companyId } = req.user; const result = await db.query('INSERT INTO machines (company_id, name, location) VALUES ($1, $2, $3) RETURNING *', [companyId, name, location]); res.status(201).json({ message: 'Machine created!', machine: result.rows[0] }); } catch (error) { console.error('Error creating machine:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.patch('/machines/:id', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { id } = req.params; const { name, location } = req.body; const { companyId } = req.user; const result = await db.query('UPDATE machines SET name = $1, location = $2 WHERE id = $3 AND company_id = $4 RETURNING *', [name, location, id, companyId]); if (result.rows.length === 0) { return res.status(404).json({ message: 'Machine not found.' }); } res.json({ message: 'Machine updated!', machine: result.rows[0] }); } catch (error) { console.error('Error updating machine:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.delete('/machines/:id', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { id } = req.params; const { companyId } = req.user; const result = await db.query('DELETE FROM machines WHERE id = $1 AND company_id = $2', [id, companyId]); if (result.rowCount === 0) { return res.status(404).json({ message: 'Machine not found.' }); } res.status(200).json({ message: 'Machine deleted.' }); } catch (error) { if (error.code === '23503') { return res.status(400).json({ message: 'Cannot delete machine. It is linked to other records.' }); } console.error('Error deleting machine:', error); res.status(500).json({ message: 'Internal server error' }); } });

// Breakdown Management
app.get('/breakdowns', authenticateToken, authorize(ALL_ROLES), async (req, res) => { try { const { companyId } = req.user; const query = ` SELECT b.id, b.description, b.status, b.reported_at, m.name AS machine_name, m.location AS machine_location FROM breakdowns b JOIN machines m ON b.machine_id = m.id WHERE b.company_id = $1 AND b.status != 'Closed' ORDER BY b.reported_at ASC `; const result = await db.query(query, [companyId]); res.json(result.rows); } catch (error) { console.error('Error fetching breakdowns:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.post('/breakdowns', authenticateToken, authorize(ALL_ROLES), async (req, res) => { try { const { machineId, description } = req.body; const { userId, companyId } = req.user; const result = await db.query('INSERT INTO breakdowns (machine_id, company_id, reported_by_id, description) VALUES ($1, $2, $3, $4) RETURNING *', [machineId, companyId, userId, description]); const newBreakdown = result.rows[0]; sendBreakdownApprovalRequest(newBreakdown.id, companyId); res.status(201).json({ message: 'Breakdown submitted for approval!', breakdown: newBreakdown }); } catch (error) { console.error('Error reporting breakdown:', error); res.status(500).json({ message: 'Internal server error' }); } });
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
app.get('/templates/preventive-maintenance', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { companyId } = req.user; const workbook = new excel.Workbook(); const pmSheet = workbook.addWorksheet('PM Tasks'); const machineSheet = workbook.addWorksheet('MachineList'); const machinesResult = await db.query('SELECT id, name FROM machines WHERE company_id = $1 ORDER BY name ASC', [companyId]); const machines = machinesResult.rows; machineSheet.columns = [ { header: 'MachineID', key: 'id', width: 10 }, { header: 'MachineName', key: 'name', width: 30 } ]; machines.forEach(machine => { machineSheet.addRow(machine); }); machineSheet.state = 'hidden'; pmSheet.columns = [ { header: 'Machine Name (Required)', key: 'machine', width: 30 }, { header: 'Task Description (Required)', key: 'description', width: 40 }, { header: 'Frequency (in days) (Required)', key: 'frequency', width: 25 }, { header: 'First Due Date (Required - YYYY-MM-DD)', key: 'startDate', width: 30, style: { numFmt: 'yyyy-mm-dd' } }, ]; if (machines.length > 0) { pmSheet.dataValidations.add('A2:A1000', { type: 'list', allowBlank: false, formulae: [`=MachineList!$B$2:$B$${machines.length + 1}`], showErrorMessage: true, errorTitle: 'Invalid Machine', error: 'Please select a valid machine from the dropdown list' }); } const instructionsSheet = workbook.addWorksheet('Instructions'); instructionsSheet.mergeCells('A1:B5'); instructionsSheet.getCell('A1').value = 'Instructions:\n1. Do not change headers.\n2. On the "PM Tasks" sheet, select a machine from the dropdown for each task.\n3. All columns are required.\n4. Dates must be in YYYY-MM-DD format.'; instructionsSheet.getCell('A1').alignment = { wrapText: true, vertical: 'top' }; res.setHeader( 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ); res.setHeader( 'Content-Disposition', 'attachment; filename="pm_tasks_template.xlsx"' ); await workbook.xlsx.write(res); res.end(); } catch (error) { console.error('Error generating PM template:', error); res.status(500).json({ message: 'Error generating template' }); } });
app.post('/preventive-maintenance/upload', authenticateToken, authorize(MANAGER_ONLY), upload.single('file'), async (req, res) => { if (!req.file) { return res.status(400).json({ message: 'No file uploaded.' }); } const { companyId } = req.user; const workbook = new excel.Workbook(); try { await workbook.xlsx.load(req.file.buffer); const worksheet = workbook.getWorksheet('PM Tasks'); if (!worksheet) { return res.status(400).json({ message: 'Invalid template: "PM Tasks" worksheet not found.' }); } const machinesResult = await db.query('SELECT id, name FROM machines WHERE company_id = $1', [companyId]); const machineMap = new Map(); machinesResult.rows.forEach(machine => { machineMap.set(machine.name.toLowerCase(), machine.id); }); let addedCount = 0; let errorCount = 0; let errors = []; const newTasks = []; for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) { const row = worksheet.getRow(rowNumber); const machineName = row.getCell('A').value; const taskDescription = row.getCell('B').value; const frequencyDays = parseInt(row.getCell('C').value, 10); const startDate = row.getCell('D').value; if (!machineName || !taskDescription || !frequencyDays || !startDate) { errors.push(`Row ${rowNumber}: Skipping row due to missing required fields.`); errorCount++; continue; } const machineId = machineMap.get(machineName.toLowerCase()); if (!machineId) { errors.push(`Row ${rowNumber}: Machine "${machineName}" not found. Skipping.`); errorCount++; continue; } try { const result = await db.query( `INSERT INTO preventive_maintenance_tasks (machine_id, company_id, task_description, frequency_days, next_due_date) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [machineId, companyId, taskDescription, frequencyDays, startDate] ); newTasks.push(result.rows[0]); addedCount++; } catch (err) { console.error(`Row ${rowNumber}: Failed to insert task "${taskDescription}":`, err.message); errors.push(`Row ${rowNumber} (${taskDescription}): ${err.message}`); errorCount++; } } res.status(201).json({ message: `Upload complete: ${addedCount} tasks added, ${errorCount} rows failed.`, newTasks: newTasks, errors: errors }); } catch (error) { console.error('Error processing PM tasks file:', error); res.status(500).json({ message: 'Error processing file.' }); } });
app.patch('/preventive-maintenance/:id', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { id } = req.params; const { taskDescription, frequencyDays, next_due_date } = req.body; const { companyId } = req.user; const result = await db.query(`UPDATE preventive_maintenance_tasks SET task_description = $1, frequency_days = $2, next_due_date = $3 WHERE id = $4 AND company_id = $5 RETURNING *`, [taskDescription, frequencyDays, next_due_date, id, companyId]); if (result.rows.length === 0) { return res.status(404).json({ message: 'Task not found.' }); } const finalResult = await db.query(`SELECT pmt.*, m.name as machine_name FROM preventive_maintenance_tasks pmt JOIN machines m ON pmt.machine_id = m.id WHERE pmt.id = $1`, [id]); res.json({ message: 'Task updated!', task: finalResult.rows[0] }); } catch (error) { console.error('Error updating task:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.delete('/preventive-maintenance/:id', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { id } = req.params; const { companyId } = req.user; const result = await db.query('DELETE FROM preventive_maintenance_tasks WHERE id = $1 AND company_id = $2', [id, companyId]); if (result.rowCount === 0) { return res.status(404).json({ message: 'Task not found.' }); } res.status(200).json({ message: 'Task deleted.' }); } catch (error) { console.error('Error deleting task:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.post('/preventive-maintenance/:id/complete', authenticateToken, authorize(MANAGER_AND_SUPERVISOR), async (req, res) => { try { const { id } = req.params; const { companyId } = req.user; const taskRes = await db.query('SELECT frequency_days FROM preventive_maintenance_tasks WHERE id = $1 AND company_id = $2', [id, companyId]); if (taskRes.rows.length === 0) { return res.status(404).json({ message: 'Task not found.' }); } const { frequency_days } = taskRes.rows[0]; const query = ` UPDATE preventive_maintenance_tasks SET last_performed_at = NOW(), next_due_date = (NOW() + ($1 * INTERVAL '1 day'))::DATE WHERE id = $2 AND company_id = $3 RETURNING * `; const result = await db.query(query, [frequency_days, id, companyId]); const updatedTaskQuery = ` SELECT pmt.*, m.name as machine_name FROM preventive_maintenance_tasks pmt JOIN machines m ON pmt.machine_id = m.id WHERE pmt.id = $1 `; const finalResult = await db.query(updatedTaskQuery, [id]); res.json({ message: 'Task marked as complete!', task: finalResult.rows[0] }); } catch (error) { console.error('Error completing task:', error); res.status(500).json({ message: 'Internal server error' }); } });

// Machine Inspection Management
app.get('/inspections', authenticateToken, authorize(MANAGER_AND_SUPERVISOR), async (req, res) => { try { const { companyId } = req.user; const query = ` SELECT ins.*, m.name as machine_name, u.name as inspected_by_name FROM machine_inspections ins JOIN machines m ON ins.machine_id = m.id JOIN users u ON ins.inspected_by_id = u.id WHERE ins.company_id = $1 ORDER BY ins.inspected_at DESC `; const result = await db.query(query, [companyId]); res.json(result.rows); } catch (error) { console.error('Error fetching machine inspections:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.post('/inspections', authenticateToken, authorize(ALL_ROLES), async (req, res) => { try { const { machineId, status, remarks } = req.body; const { userId, companyId } = req.user; if (!machineId || !status) { return res.status(400).json({ message: 'Machine ID and status are required.' }); } if (status === 'Not Okay' && !remarks) { return res.status(400).json({ message: 'Remarks are required if status is "Not Okay".' }); } const result = await db.query( `INSERT INTO machine_inspections (machine_id, company_id, inspected_by_id, status, remarks) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [machineId, companyId, userId, status, remarks || null] ); res.status(201).json({ message: 'Inspection logged successfully!', inspection: result.rows[0] }); } catch (error) { console.error('Error logging inspection:', error); res.status(500).json({ message: 'Internal server error' }); } });

// --- SERVER STARTUP ---
app.listen(PORT, () => {
  console.log(`>>>> BACKEND SERVER VERSION 2.0 IS RUNNING SUCCESSFULLY ON PORT ${PORT} <<<<`);
});