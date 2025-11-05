// backend/index.js (v2.2.2 - Fixed typos)

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./db');
const cors = require('cors');
const twilio = require('twilio');
const cron = require('node-cron');
const excel = require('exceljs');
const multer = require('multer');

// --- NEW IMPORTS ---
const { MailerSend, EmailParams, Sender, Recipient } = require('mailersend');
const crypto = require('crypto'); // Built-in node module
// --- END NEW IMPORTS ---

const { authenticateToken, authorize } = require('./middleware/authMiddleware');
const { sendBulkWhatsAppMessages } = require('./whatsappService');

const app = express();
const PORT = 4000;

// Middleware Setup
app.use(express.urlencoded({ extended: false })); // For Twilio webhooks
app.use(express.json()); // For API requests
app.use(cors()); // For allowing frontend access
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// --- NEW: MailerSend Setup ---
const mailerSend = new MailerSend({
  apiKey: process.env.MAILERSEND_API_KEY,
});

const sentFrom = new Sender(
    process.env.MAILERSEND_FROM_EMAIL, // Your verified "From" email
    process.env.MAILERSEND_FROM_NAME    // Your "From" name (e.g., "PlantMaint Pro")
);
// --- END NEW ---

// --- Password Strength Helper Function ---
const isPasswordStrong = (password) => {
    if (!password || password.length < 8) {
        return false;
    }
    const hasNumber = /\d/.test(password);
    const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
    return hasNumber && hasSpecial;
};
const WEAK_PASSWORD_MESSAGE = 'Password must be at least 8 characters long and contain at least one number and one special character.';
// --- END ---


// --- HELPER & BACKGROUND JOBS ---
// (All helper functions: sendBreakdownApprovalRequest, notifyTechniciansAndManager, handleUtilityReading are 100% UNCHANGED)
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
        const approvalMessage = `⚠️ New Breakdown Reported for ${machine_name} ⚠️\nIssue: ${description}\nReported by: ${reporter_name}\n\nPlease open the menu (send 'hi' or 'menu') to approve or disapprove this breakdown.`;
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
             `SELECT id, phone_number, role FROM users WHERE company_id = $1 AND role IN ('Maintenance Technician', 'Maintenance Manager')`,
             [companyId]
         );
         if (recipients.rows.length === 0) {
             console.log("No technicians or managers found to notify about approval.");
             return;
         }
         const techMessage = `🛠️ New Job for ${machine_name} 🛠️\n\nIssue: ${description}\nApproved by: ${approverName}\n\nPlease open the menu (send 'hi') to acknowledge this job.`;
         const managerMessage = `ℹ️ Breakdown for ${machine_name} has been approved by ${approverName} and sent to technicians.`;
         const messagesToSend = recipients.rows
             .filter(r => r.phone_number)
             .map(r => ({
                 to: r.phone_number.replace('whatsapp:+', ''),
                 text: r.role === 'Maintenance Technician' ? techMessage : managerMessage,
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
async function handleUtilityReading(user, messageBody) {
  console.log(`Attempting to process utility reading for user ${user.id}: "${messageBody}"`);
  let responseMessage = null; 
  const utilityMatch = messageBody.match(/^([a-zA-Z]+)\s+([\d\.]+)$/);
  if (!utilityMatch) {
    console.log("Utility reading format did not match.");
    return null; 
  }
  const keyword = utilityMatch[1].toLowerCase();
  const readingValue = parseFloat(utilityMatch[2]);
  try {
    const utilityResult = await db.query(
        `SELECT id, name, unit FROM utilities WHERE keyword = $1 AND company_id = $2`,
        [keyword, user.company_id]
    );
    if (utilityResult.rows.length === 0) {
        responseMessage = `Sorry, I don't recognize the utility keyword "${keyword}". Please use a registered keyword (e.g., 'power').`;
    } else if (isNaN(readingValue)) {
        responseMessage = "Invalid reading value. Please enter a number (e.g., 'power 123.45').";
    } else {
        const utility = utilityResult.rows[0];
        await db.query(
            `INSERT INTO utility_readings (utility_id, user_id, reading_value)
             VALUES ($1, $2, $3)`,
            [utility.id, user.id, readingValue]
        );
        responseMessage = `✅ Reading logged: ${readingValue} ${utility.unit} for ${utility.name}.`;
    }
  } catch (dbError) {
      console.error(`Database error processing utility reading for keyword "${keyword}":`, dbError);
      responseMessage = "An error occurred while saving your reading. Please try again.";
  }
  if (responseMessage) {
    await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
  }
  return responseMessage;
}
// --- END OF UNCHANGED FUNCTIONS ---


// Simple endpoint for testing
app.get('/', (req, res) => { res.send('Your PlantMaint Pro server is running!'); });

// --- WHATSAPP WEBHOOK ---
// (This entire '/whatsapp' endpoint is 100% UNCHANGED)
app.post('/whatsapp', async (req, res) => {
    // ... (All WhatsApp logic remains identical) ...
    // Respond immediately to Twilio to prevent timeouts
    const twiml = new twilio.twiml.MessagingResponse();
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml.toString());

    // --- Process message asynchronously ---
    try {
        const from = req.body.From; // e.g., whatsapp:+1...
        const msg_body_original = req.body.Body.trim();
        const msg_body_lower = msg_body_original.toLowerCase(); // Use lower case for commands
        const recipientNumber = from.replace('whatsapp:+', ''); 
        console.log(`\n--- Incoming message from ${from}: "${msg_body_original}"`);

        const userResult = await db.query('SELECT * FROM users WHERE phone_number = $1', [from]);
        if (userResult.rows.length === 0) {
             await sendBulkWhatsAppMessages([{ to: recipientNumber, text: "Sorry, your phone number is not registered." }]);
             return;
        }

        const user = userResult.rows[0];
        const currentState = user.whatsapp_state || 'IDLE';
        let context = user.whatsapp_context || {};
        const userRole = user.role;
        let finalResponseMessage = null; 
        
        if (currentState === 'IDLE' && /^([a-zA-Z]+)\s+([\d\.]+)$/.test(msg_body_original)) {
            console.log("DEBUG: User is IDLE and message matches utility format, handling...");
            finalResponseMessage = await handleUtilityReading(user, msg_body_original);
            if(finalResponseMessage) {
                console.log("DEBUG: Utility reading handled successfully.");
            } else {
                console.log("DEBUG: Utility regex matched but handler returned null, proceeding to standard flow.");
            }
        }

        if (finalResponseMessage === null) { 
             const reset_words = ['hi', 'hello', 'menu', 'cancel', 'start'];
             if (reset_words.includes(msg_body_lower) || currentState === 'IDLE') {
                 console.log("DEBUG: Resetting conversation to main menu.");
                 let menuOptions = {};
                 let menuCounter = 1; 
                 finalResponseMessage = `Welcome ${user.name}. Please choose an option:\n`;
                 context = {};

                 let pendingApprovals = { rowCount: 0 };
                 let pendingTechAcks = { rowCount: 0 };
                 let pendingManagerAcks = { rowCount: 0 };

                 if (['Supervisor', 'Maintenance Manager'].includes(userRole)) {
                     pendingApprovals = await db.query("SELECT id FROM breakdowns WHERE company_id = $1 AND status = 'Pending Approval' LIMIT 5", [user.company_id]);
                     pendingManagerAcks = await db.query("SELECT id FROM breakdowns WHERE company_id = $1 AND status = 'Resolved' AND manager_acknowledged_at IS NULL LIMIT 5", [user.company_id]);
                 }
                 if (userRole === 'Maintenance Technician') {
                     pendingTechAcks = await db.query("SELECT id FROM breakdowns WHERE company_id = $1 AND status = 'Reported' LIMIT 5", [user.company_id]);
                 }

                 if (userRole === 'Operator') {
                     menuOptions['1'] = { text: 'Report Breakdown', nextState: 'AWAITING_MACHINE_CHOICE_BREAKDOWN' };
                     menuOptions['2'] = { text: 'Check Breakdown Status', nextState: 'AWAITING_STATUS_MACHINE_CHOICE' };
                     menuOptions['3'] = { text: 'Report Breakdown Completion', nextState: 'AWAITING_COMPLETION_CHOICE' };
                     
                 } else if (userRole === 'Supervisor') {
                     menuOptions['1'] = { text: 'Check Breakdown Status', nextState: 'AWAITING_STATUS_MACHINE_CHOICE' };
                     menuOptions['2'] = { text: 'Request Job Order', nextState: 'AWAITING_JOB_ORDER_MACHINE' };
                     menuOptions['3'] = { text: 'Check Job Order Status', nextState: 'AWAITING_JOB_ORDER_ID_STATUS' };
                     menuCounter = 4;
                     if (pendingApprovals.rowCount > 0) {
                         menuOptions[menuCounter.toString()] = { text: `Approve Pending Breakdowns (${pendingApprovals.rowCount})`, nextState: 'AWAITING_APPROVAL_CHOICE' };
                         menuCounter++;
                     }
                     if (pendingManagerAcks.rowCount > 0) {
                         menuOptions[menuCounter.toString()] = { text: `Acknowledge Completed Jobs (${pendingManagerAcks.rowCount})`, nextState: 'AWAITING_MANAGER_ACK_CHOICE' };
                         menuCounter++;
                     }

                 } else if (userRole === 'Maintenance Technician') {
                     menuOptions['1'] = { text: 'Report Breakdown Completion', nextState: 'AWAITING_COMPLETION_CHOICE' };
                     menuOptions['2'] = { text: 'Check Job Order Status', nextState: 'AWAITING_JOB_ORDER_ID_STATUS' };
                     menuOptions['3'] = { text: 'Machine Inspection', nextState: 'AWAITING_INSPECTION_MACHINE' };
                     menuOptions['4'] = { text: 'Check Breakdown Status', nextState: 'AWAITING_STATUS_MACHINE_CHOICE' };
                     menuOptions['5'] = { text: 'Check PM Activities', nextState: 'PM_ACTIVITIES_LIST' };
                     menuOptions['6'] = { text: 'Report PM Completion', nextState: 'AWAITING_PM_COMPLETION_CHOICE' };
                     menuCounter = 7;
                     if (pendingTechAcks.rowCount > 0) {
                         menuOptions[menuCounter.toString()] = { text: `Acknowledge New Jobs (${pendingTechAcks.rowCount})`, nextState: 'AWAITING_TECH_ACK_CHOICE' };
                         menuCounter++;
                     }

                 } else if (userRole === 'Maintenance Manager') {
                     menuOptions['1'] = { text: 'Check Breakdown Status', nextState: 'AWAITING_STATUS_MACHINE_CHOICE' };
                     menuOptions['2'] = { text: 'Check Job Order Status', nextState: 'AWAITING_JOB_ORDER_ID_STATUS' };
                     menuOptions['3'] = { text: 'Create Job Order', nextState: 'AWAITING_JOB_ORDER_MACHINE' }; 
                     menuOptions['4'] = { text: 'Check PM Activities', nextState: 'PM_ACTIVITIES_LIST' };
                     menuOptions['5'] = { text: 'Check KPIs', nextState: 'KPI_REPORT' };
                     menuCounter = 6;
                     if (pendingApprovals.rowCount > 0) {
                         menuOptions[menuCounter.toString()] = { text: `Approve Pending Breakdowns (${pendingApprovals.rowCount})`, nextState: 'AWAITING_APPROVAL_CHOICE' };
                         menuCounter++;
                     }
                     if (pendingManagerAcks.rowCount > 0) {
                         menuOptions[menuCounter.toString()] = { text: `Acknowledge Completed Jobs (${pendingManagerAcks.rowCount})`, nextState: 'AWAITING_MANAGER_ACK_CHOICE' };
                         menuCounter++;
                     }

                 } else { 
                     menuOptions['1'] = { text: 'Check Breakdown Status', nextState: 'AWAITING_STATUS_MACHINE_CHOICE' };
                     menuOptions['2'] = { text: 'Check Job Order Status', nextState: 'AWAITING_JOB_ORDER_ID_STATUS' };
                     menuOptions['3'] = { text: 'Check PM Activities', nextState: 'PM_ACTIVITIES_LIST' };
                     menuOptions['4'] = { text: 'Check KPIs', nextState: 'KPI_REPORT' };
                     menuCounter = 5;
                     if (pendingManagerAcks.rowCount > 0) {
                         menuOptions[menuCounter.toString()] = { text: `Acknowledge Completed Jobs (${pendingManagerAcks.rowCount})`, nextState: 'AWAITING_MANAGER_ACK_CHOICE' };
                         menuCounter++;
                     }
                 }
                 
                 for (const key in menuOptions) {
                     finalResponseMessage += `${key}. ${menuOptions[key].text}\n`;
                 }

                 context.current_menu = menuOptions;
                 await db.query("UPDATE users SET whatsapp_state = 'AWAITING_MENU_CHOICE', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                 console.log("DEBUG: User state set to AWAITING_MENU_CHOICE.");

             } else { 
                  console.log(`DEBUG: Continuing conversation in state: ${currentState}`);
                  
                  switch (currentState) {
                      case 'AWAITING_MENU_CHOICE': {
                          const selectedOption = context.current_menu?.[msg_body_lower]; 
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
                                      openBreakdowns.rows.forEach((b, i) => { breakdownList += `${i + 1}. ${b.machine_name}\n`; });
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
                              else if (selectedOption.nextState === 'AWAITING_APPROVAL_CHOICE') {
                                  const pending = await db.query(
                                      `SELECT b.id, m.name as machine_name, b.description 
                                       FROM breakdowns b JOIN machines m ON b.machine_id = m.id 
                                       WHERE b.company_id = $1 AND b.status = 'Pending Approval' ORDER BY b.id ASC`,
                                      [user.company_id]
                                  );
                                  if (pending.rows.length === 0) {
                                      finalResponseMessage = "No breakdowns are currently pending approval.";
                                      await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                                  } else {
                                      let breakdownList = "Which breakdown do you want to action?\n";
                                      context.approval_map = pending.rows.map(b => b.id); 
                                      pending.rows.forEach((b, i) => { 
                                          breakdownList += `${i + 1}. ${b.machine_name} (${b.description.substring(0, 30)}...)\n`; 
                                      });
                                      finalResponseMessage = breakdownList;
                                      await db.query("UPDATE users SET whatsapp_state = 'AWAITING_APPROVAL_SELECTION', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                                  }
                              }
                              else if (selectedOption.nextState === 'AWAITING_TECH_ACK_CHOICE') {
                                  const pending = await db.query(
                                      `SELECT b.id, m.name as machine_name, b.description 
                                       FROM breakdowns b JOIN machines m ON b.machine_id = m.id 
                                       WHERE b.company_id = $1 AND b.status = 'Reported' ORDER BY b.id ASC`,
                                      [user.company_id]
                                  );
                                  if (pending.rows.length === 0) {
                                      finalResponseMessage = "No new jobs are waiting for acknowledgement.";
                                      await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                                  } else {
                                      let breakdownList = "Which new job do you want to acknowledge?\n";
                                      context.tech_ack_map = pending.rows.map(b => b.id); 
                                      pending.rows.forEach((b, i) => { 
                                          breakdownList += `${i + 1}. ${b.machine_name} (${b.description.substring(0, 30)}...)\n`; 
                                      });
                                      finalResponseMessage = breakdownList;
                                      await db.query("UPDATE users SET whatsapp_state = 'AWAITING_TECH_ACK_SELECTION', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                                  }
                              }
                              else if (selectedOption.nextState === 'AWAITING_MANAGER_ACK_CHOICE') {
                                  const pending = await db.query(
                                      `SELECT b.id, m.name as machine_name, b.description 
                                       FROM breakdowns b JOIN machines m ON b.machine_id = m.id 
                                       WHERE b.company_id = $1 AND b.status = 'Resolved' AND b.manager_acknowledged_at IS NULL ORDER BY b.id ASC`,
                                      [user.company_id]
                                  );
                                  if (pending.rows.length === 0) {
                                      finalResponseMessage = "No completed jobs are waiting for your acknowledgement.";
                                      await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                                  } else {
                                      let breakdownList = "Which completed job do you want to acknowledge?\n";
                                      context.manager_ack_map = pending.rows.map(b => b.id); 
                                      pending.rows.forEach((b, i) => { 
                                          breakdownList += `${i + 1}. ${b.machine_name}\n`; 
                                      });
                                      finalResponseMessage = breakdownList;
                                      await db.query("UPDATE users SET whatsapp_state = 'AWAITING_MANAGER_ACK_SELECTION', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
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
                          break;
                      } 
                      case 'AWAITING_MACHINE_CHOICE_BREAKDOWN': {
                          const breakdownChoiceIndex = parseInt(msg_body_lower, 10) - 1; 
                          if (context.machine_id_map && breakdownChoiceIndex >= 0 && breakdownChoiceIndex < context.machine_id_map.length) {
                              context.selected_machine_id = context.machine_id_map[breakdownChoiceIndex];
                              finalResponseMessage = "Is the issue:\n1. Electrical\n2. Mechanical";
                              await db.query("UPDATE users SET whatsapp_state = 'AWAITING_ISSUE_TYPE', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                          } else {
                              finalResponseMessage = "Invalid machine number. Please try again.";
                          }
                          break;
                      }
                      case 'AWAITING_ISSUE_TYPE': {
                          let issueType = '';
                          if (msg_body_lower === '1') issueType = 'Electrical'; 
                          if (msg_body_lower === '2') issueType = 'Mechanical'; 
                          if (issueType) {
                              context.issue_type = issueType;
                              finalResponseMessage = "Thank you. Please provide a brief description of the issue.";
                              await db.query("UPDATE users SET whatsapp_state = 'AWAITING_DESCRIPTION', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                          } else {
                              finalResponseMessage = "Invalid choice. Reply 1 for Electrical or 2 for Mechanical.";
                          }
                          break;
                      }
                      case 'AWAITING_DESCRIPTION': {
                          const description = `${context.issue_type} Issue: ${msg_body_original}`; 
                          const machineId = context.selected_machine_id;
                          const newBreakdown = await db.query('INSERT INTO breakdowns (machine_id, company_id, reported_by_id, description) VALUES ($1, $2, $3, $4) RETURNING id', [machineId, user.company_id, user.id, description]);
                          const newBreakdownId = newBreakdown.rows[0].id;
                          const machineResult = await db.query('SELECT name FROM machines WHERE id = $1', [machineId]);
                          const machineName = machineResult.rows.length > 0 ? machineResult.rows[0].name : 'Unknown Machine';
                          finalResponseMessage = `✅ Breakdown for ${machineName} submitted for approval.`;
                          await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                          sendBreakdownApprovalRequest(newBreakdownId, user.company_id);
                          break;
                      }
                      case 'AWAITING_STATUS_MACHINE_CHOICE': {
                          const statusChoiceIndex = parseInt(msg_body_lower, 10) - 1; 
                          if (context.machine_id_map && statusChoiceIndex >= 0 && statusChoiceIndex < context.machine_id_map.length) {
                              const selectedMachineId = context.machine_id_map[statusChoiceIndex];
                              const breakdownResult = await db.query(
                                  `SELECT b.id, b.status, b.updated_at, m.name as machine_name 
                                   FROM breakdowns b 
                                   JOIN machines m ON b.machine_id = m.id 
                                   WHERE b.machine_id = $1 AND b.company_id = $2 
                                   ORDER BY b.reported_at DESC LIMIT 1`, 
                                  [selectedMachineId, user.company_id]
                              );
                              if (breakdownResult.rows.length === 0) {
                                  finalResponseMessage = "No breakdown reports found for this machine.";
                              } else {
                                  const b = breakdownResult.rows[0];
                                  const lastUpdated = b.updated_at ? new Date(b.updated_at).toLocaleString() : 'N/A';
                                  finalResponseMessage = `ℹ️ Latest status for ${b.machine_name} is: *${b.status}* (Last updated: ${lastUpdated})`;
                              }
                              await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                          } else {
                              finalResponseMessage = "Invalid machine number. Please try again.";
                          }
                          break;
                      }
                       case 'AWAITING_COMPLETION_CHOICE': {
                          const completionChoiceIndex = parseInt(msg_body_lower, 10) - 1; 
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
                       }
                       case 'AWAITING_OPERATOR_CONFIRMATION': {
                          if (userRole === 'Operator') {
                              const breakdownIdToConfirm = context.breakdown_to_complete;
                              const breakdownInfo = await db.query(`SELECT m.name as machine_name FROM breakdowns b JOIN machines m ON b.machine_id = m.id WHERE b.id = $1`, [breakdownIdToConfirm]);
                              const machineName = breakdownInfo.rows.length > 0 ? breakdownInfo.rows[0].machine_name : 'the breakdown';
                              if (msg_body_lower === '1') { 
                                  await db.query(`UPDATE breakdowns SET status = 'Resolved' WHERE id = $1`, [breakdownIdToConfirm]);
                                  finalResponseMessage = `Thank you for confirming completion of the breakdown for ${machineName}.`;
                              } else { 
                                  finalResponseMessage = `Okay, status for the ${machineName} breakdown remains unchanged. Please inform your supervisor.`;
                              }
                               await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                          } else {
                               finalResponseMessage = "State error. Resetting. Send 'hi'.";
                               await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                          }
                          break;
                       }
                       case 'AWAITING_COMPLETION_REMARK': {
                          if (userRole === 'Maintenance Technician') {
                              context.completion_remark = msg_body_original; 
                              finalResponseMessage = "Thank you. What was the root cause of the problem?";
                              await db.query("UPDATE users SET whatsapp_state = 'AWAITING_ROOT_CAUSE', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                          } else {
                               finalResponseMessage = "State error. Resetting. Send 'hi'.";
                               await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                          }
                          break;
                       }
                       case 'AWAITING_ROOT_CAUSE': {
                            if (userRole === 'Maintenance Technician') {
                                context.root_cause = msg_body_original; 
                                finalResponseMessage = "Was the root cause attended to?\n1. Yes\n2. No";
                                await db.query("UPDATE users SET whatsapp_state = 'AWAITING_ROOT_CAUSE_FIXED', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                          } else {
                               finalResponseMessage = "State error. Resetting. Send 'hi'.";
                               await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                          }
                          break;
                       }
                        case 'AWAITING_ROOT_CAUSE_FIXED': {
                             if (userRole === 'Maintenance Technician') {
                                const breakdownIdToComplete = context.breakdown_to_complete;
                                const remark = context.completion_remark;
                                const rootCause = context.root_cause;
                                const rootCauseFixed = msg_body_lower === '1'; 
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
                                const machineNameResult = await db.query(`SELECT name as machine_name FROM machines WHERE id = $1`, [completedMachineId]);
                                const machineName = machineNameResult.rows.length > 0 ? machineNameResult.rows[0].machine_name : 'Unknown Machine';
                                const supervisors = await db.query(`SELECT id, phone_number FROM users WHERE company_id = $1 AND role IN ('Supervisor', 'Maintenance Manager')`, [user.company_id]);
                                const originalReporterResult = await db.query(`SELECT u.id, u.phone_number FROM users u JOIN breakdowns b ON u.id = b.reported_by_id WHERE b.id = $1`, [breakdownIdToComplete]);
                                let messagesToSend = [];
                                const supervisorMessage = `✅ Breakdown for ${machineName} has been marked as '${finalStatus}' by ${user.name}.${rootCauseFixed ? '' : ' Root cause pending.'}\n\nPlease open the menu (send 'hi') to acknowledge.`;
                                supervisors.rows.forEach(s => { if (s.phone_number) messagesToSend.push({ to: s.phone_number.replace('whatsapp:+', ''), text: supervisorMessage, recipientId: s.id }); });
                                if (originalReporterResult.rows.length > 0 && originalReporterResult.rows[0].phone_number && originalReporterResult.rows[0].id !== user.id) {
                                    const reporterMessage = `Update: The breakdown for ${machineName} that you reported has been resolved${rootCauseFixed ? '.' : ' (root cause pending).'}`;
                                    messagesToSend.push({ to: originalReporterResult.rows[0].phone_number.replace('whatsapp:+', ''), text: reporterMessage, recipientId: originalReporterResult.rows[0].id });
                                }
                                if (messagesToSend.length > 0) { sendBulkWhatsAppMessages(messagesToSend); }
                                finalResponseMessage = `Thank you. The breakdown for ${machineName} has been updated.`;
                                await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                             } else {
                                 finalResponseMessage = "State error. Resetting. Send 'hi'.";
                                 await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                             }
                             break;
                        }
                       case 'AWAITING_JOB_ORDER_MACHINE': {
                            const joMachineChoiceIndex = parseInt(msg_body_lower, 10) - 1; 
                            if (context.machine_id_map && joMachineChoiceIndex >= 0 && joMachineChoiceIndex < context.machine_id_map.length) {
                                context.selected_machine_id = context.machine_id_map[joMachineChoiceIndex];
                                finalResponseMessage = "Please provide a brief description of the work to be done for this Job Order.";
                                await db.query("UPDATE users SET whatsapp_state = 'AWAITING_JOB_ORDER_DESCRIPTION', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                            } else {
                                finalResponseMessage = "Invalid machine number. Please try again.";
                            }
                            break;
                       }
                       case 'AWAITING_JOB_ORDER_DESCRIPTION': {
                            const joDescription = msg_body_original; 
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
                       }
                       case 'AWAITING_JOB_ORDER_ID_STATUS': {
                            const jobOrderId = parseInt(msg_body_lower, 10); 
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
                       }
                       case 'AWAITING_INSPECTION_MACHINE': {
                            const inspectionChoiceIndex = parseInt(msg_body_lower, 10) - 1; 
                            if (context.machine_id_map && inspectionChoiceIndex >= 0 && inspectionChoiceIndex < context.machine_id_map.length) {
                                context.selected_machine_id = context.machine_id_map[inspectionChoiceIndex];
                                finalResponseMessage = "Is the machine status:\n1. Okay\n2. Not Okay";
                                await db.query("UPDATE users SET whatsapp_state = 'AWAITING_INSPECTION_STATUS', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                            } else {
                                finalResponseMessage = "Invalid machine number. Please try again.";
                            }
                            break;
                       }
                       case 'AWAITING_INSPECTION_STATUS': {
                            const inspMachineId = context.selected_machine_id;
                            if (msg_body_lower === '1') { 
                                await db.query(`INSERT INTO machine_inspections (machine_id, company_id, inspected_by_id, status, remarks) VALUES ($1, $2, $3, 'Okay', 'Machine checked and found to be in good condition.')`, [inspMachineId, user.company_id, user.id]);
                                finalResponseMessage = `Inspection for machine ID #${inspMachineId} logged as 'Okay'.\n\nSend 'hi' to start over.`;
                                await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                            } else if (msg_body_lower === '2') { 
                                finalResponseMessage = "Please provide a brief description of the problem you observed.";
                                await db.query("UPDATE users SET whatsapp_state = 'AWAITING_INSPECTION_REMARKS', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                            } else {
                                finalResponseMessage = "Invalid choice. Please reply with 1 for 'Okay' or 2 for 'Not Okay'.";
                            }
                            break;
                       }
                       case 'AWAITING_INSPECTION_REMARKS': {
                            const inspMachineIdRemarks = context.selected_machine_id;
                            const inspectionRemarks = msg_body_original; 
                            await db.query(`INSERT INTO machine_inspections (machine_id, company_id, inspected_by_id, status, remarks) VALUES ($1, $2, $3, 'Not Okay', $4)`, [inspMachineIdRemarks, user.company_id, user.id, inspectionRemarks]);
                            finalResponseMessage = `Inspection for machine ID #${inspMachineIdRemarks} logged as 'Not Okay'. Thank you.\n\nSend 'hi' to start over.`;
                            await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                            break;
                       }
                       case 'AWAITING_PM_TASK_SELECTION': {
                            const pmChoiceIndex = parseInt(msg_body_lower, 10) - 1; 
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
                       }
                       case 'AWAITING_APPROVAL_SELECTION': {
                           const approvalChoiceIndex = parseInt(msg_body_lower, 10) - 1;
                           if (context.approval_map && approvalChoiceIndex >= 0 && approvalChoiceIndex < context.approval_map.length) {
                               context.selected_breakdown_id = context.approval_map[approvalChoiceIndex];
                               const breakdownInfo = await db.query(`SELECT m.name as machine_name FROM breakdowns b JOIN machines m ON b.machine_id = m.id WHERE b.id = $1`, [context.selected_breakdown_id]);
                               if (breakdownInfo.rows.length === 0) {
                                    finalResponseMessage = "Error: Could not find that breakdown. Please start over.";
                                    await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                                    break;
                               }
                               const machineName = breakdownInfo.rows[0].machine_name;
                               context.selected_machine_name = machineName; 
                               finalResponseMessage = `You selected the breakdown for ${machineName}. Do you want to:\n1. Approve\n2. Disapprove`;
                               await db.query("UPDATE users SET whatsapp_state = 'AWAITING_APPROVAL_CONFIRMATION', whatsapp_context = $1 WHERE id = $2", [context, user.id]);
                           } else {
                               finalResponseMessage = "Invalid breakdown number. Please try again.";
                           }
                           break;
                       }
                       case 'AWAITING_APPROVAL_CONFIRMATION': {
                           const breakdownIdToUpdate = context.selected_breakdown_id;
                           const machineName = context.selected_machine_name || 'the breakdown';
                           if (!breakdownIdToUpdate) {
                               finalResponseMessage = "Error: Lost context. Please start over.";
                               await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                               break;
                           }
                           let action, newStatus;
                           if (msg_body_lower === '1') {
                               action = 'approve';
                               newStatus = 'Reported';
                           } else if (msg_body_lower === '2') {
                               action = 'disapprove';
                               newStatus = 'Closed';
                           } else {
                               finalResponseMessage = "Invalid choice. Please reply '1' to Approve or '2' to Disapprove.";
                               break; 
                           }
                           const statusUpdate = await db.query(
                               `UPDATE breakdowns SET status = $1, approved_by_id = $2 WHERE id = $3 AND company_id = $4 AND status = 'Pending Approval' RETURNING id`,
                               [newStatus, user.id, breakdownIdToUpdate, user.company_id]
                           );
                           if (statusUpdate.rowCount > 0) {
                               finalResponseMessage = `The breakdown for ${machineName} has been ${action}d.`;
                               if (action === 'approve') {
                                   notifyTechniciansAndManager(breakdownIdToUpdate, user.company_id, user.name);
                               }
                               const reporterRes = await db.query(`SELECT reported_by_id, phone_number FROM breakdowns b JOIN users u ON b.reported_by_id = u.id WHERE b.id = $1`, [breakdownIdToUpdate]);
                               if (reporterRes.rows.length > 0 && reporterRes.rows[0].phone_number) {
                                   const reporterPhone = reporterRes.rows[0].phone_number.replace('whatsapp:+', '');
                                   const reporterMsg = `Update: Your breakdown for ${machineName} has been ${action}d by ${user.name}.`;
                                   await sendBulkWhatsAppMessages([{ to: reporterPhone, text: reporterMsg, recipientId: reporterRes.rows[0].reported_by_id }]);
                               }
                           } else {
                               finalResponseMessage = `Could not ${action} the breakdown for ${machineName}. It might already be processed.`;
                           }
                           await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                           break;
                       }
                       case 'AWAITING_TECH_ACK_SELECTION': {
                           const techAckChoiceIndex = parseInt(msg_body_lower, 10) - 1;
                           if (context.tech_ack_map && techAckChoiceIndex >= 0 && techAckChoiceIndex < context.tech_ack_map.length) {
                               const breakdownIdToAck = context.tech_ack_map[techAckChoiceIndex];
                               const currentBreakdown = await db.query(`SELECT b.status, m.name as machine_name FROM breakdowns b JOIN machines m ON b.machine_id = m.id WHERE b.id = $1 AND b.company_id = $2`, [breakdownIdToAck, user.company_id]);
                               if (currentBreakdown.rows.length === 0) {
                                   finalResponseMessage = `Breakdown was not found.`;
                               } else {
                                   const { status, machine_name } = currentBreakdown.rows[0];
                                   if (status !== 'Reported') {
                                       finalResponseMessage = `The breakdown for ${machine_name} has already been acknowledged or is in progress.`;
                                   } else {
                                       await db.query(`UPDATE breakdowns SET status = 'Acknowledged', assigned_to_id = $1 WHERE id = $2`, [user.id, breakdownIdToAck]);
                                       finalResponseMessage = `✅ You have acknowledged the breakdown for ${machine_name}. Status updated to 'Acknowledged'.`;
                                       const managers = await db.query(`SELECT id, phone_number FROM users WHERE company_id = $1 AND role IN ('Supervisor', 'Maintenance Manager')`, [user.company_id]);
                                       const managerMessage = `ℹ️ Update: The breakdown for ${machine_name} has been acknowledged by ${user.name}.`;
                                       const messagesToSend = managers.rows.filter(m => m.phone_number).map(m => ({ to: m.phone_number.replace('whatsapp:+', ''), text: managerMessage, recipientId: m.id }));
                                       if (messagesToSend.length > 0) {
                                           sendBulkWhatsAppMessages(messagesToSend); 
                                       }
                                   }
                               }
                               await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                           } else {
                               finalResponseMessage = "Invalid job number. Please try again.";
                           }
                           break;
                       }
                       case 'AWAITING_MANAGER_ACK_SELECTION': {
                           const managerAckChoiceIndex = parseInt(msg_body_lower, 10) - 1;
                           if (context.manager_ack_map && managerAckChoiceIndex >= 0 && managerAckChoiceIndex < context.manager_ack_map.length) {
                               const breakdownIdToAck = context.manager_ack_map[managerAckChoiceIndex];
                               const breakdownInfo = await db.query(`SELECT m.name as machine_name FROM breakdowns b JOIN machines m ON b.machine_id = m.id WHERE b.id = $1`, [breakdownIdToAck]);
                               const machineName = breakdownInfo.rows.length > 0 ? breakdownInfo.rows[0].machine_name : 'the breakdown';
                               const ackUpdate = await db.query(
                                   `UPDATE breakdowns SET manager_acknowledged_at = NOW() 
                                    WHERE id = $1 AND company_id = $2 AND status = 'Resolved' AND manager_acknowledged_at IS NULL RETURNING id`,
                                   [breakdownIdToAck, user.company_id]
                               );
                               if (ackUpdate.rowCount > 0) {
                                   finalResponseMessage = `✅ Completion of the breakdown for ${machineName} has been acknowledged.`;
                               } else {
                                   finalResponseMessage = `Could not acknowledge the breakdown for ${machineName}. It may already be acknowledged.`;
                               }
                               await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                           } else {
                               finalResponseMessage = "Invalid job number. Please try again.";
                           }
                           break;
                       }
                       default: {
                            finalResponseMessage = "Sorry, I got confused. Let's start over. Send 'hi' to begin.";
                            await db.query("UPDATE users SET whatsapp_state = 'IDLE', whatsapp_context = NULL WHERE id = $1", [user.id]);
                            break;
                       }
                  } 
             } 
        } 
       
         if (finalResponseMessage) {
             console.log(`DEBUG: Sending TwiML response: ${finalResponseMessage.replace(/\n/g, " ")}`);
             await sendBulkWhatsAppMessages([{ to: recipientNumber, text: finalResponseMessage, recipientId: user.id }]); 
         } else {
             console.log("DEBUG: No final response message generated.");
         }
    } catch (error) {
         console.error("CRITICAL ERROR in /whatsapp endpoint:", error);
         try {
             const from = req.body.From;
             if (from) {
                 const recipientNumber = from.replace('whatsapp:+', '');
                 await sendBulkWhatsAppMessages([{ to: recipientNumber, text: "Sorry, a critical system error occurred. Please try again." }]);
             }
         } catch (notifyError) {
             console.error("Failed to send error notification:", notifyError);
         }
    }
});


// --- AUTH ENDPOINTS ---

// (POST /register is 100% UNCHANGED from last file)
app.post('/register', async (req, res) => { 
    try { 
        const { companyName, userName, email, password, phoneNumber } = req.body; 
        
        if (!isPasswordStrong(password)) {
            return res.status(400).json({ message: WEAK_PASSWORD_MESSAGE });
        }

        const passwordHash = await bcrypt.hash(password, 10); 
        const companyResult = await db.query('INSERT INTO companies (name) VALUES ($1) RETURNING id', [companyName]); 
        const newCompanyId = companyResult.rows[0].id; 
        const formattedPhoneNumber = phoneNumber ? `whatsapp:+${phoneNumber.replace(/[^0-9]/g, '')}` : null; 
        const userResult = await db.query(`INSERT INTO users (company_id, name, email, password_hash, role, phone_number) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, email, role`, [newCompanyId, userName, email, passwordHash, 'Maintenance Manager', formattedPhoneNumber]); 
        res.status(201).json({ message: 'Registration successful!', user: userResult.rows[0] }); 
    } catch (error) { 
        if (error.code === '23505') { 
            return res.status(400).json({ message: 'Error: Email or phone number already in use.' }); 
        } 
        console.error('Registration error:', error); 
        res.status(500).json({ message: 'Internal server error' }); 
    } 
});

// (POST /login is 100% UNCHANGED)
app.post('/login', async (req, res) => { try { const { email, password } = req.body; const query = `SELECT u.*, c.name as company_name FROM users u JOIN companies c ON u.company_id = c.id WHERE u.email = $1`; const result = await db.query(query, [email]); const user = result.rows[0]; const passwordMatches = user ? await bcrypt.compare(password, user.password_hash) : false; if (!passwordMatches) { return res.status(401).json({ message: 'Invalid credentials' }); } const token = jwt.sign({ userId: user.id, role: user.role, companyId: user.company_id }, process.env.JWT_SECRET, { expiresIn: '8h' }); delete user.password_hash; res.json({ message: 'Login successful!', token: token, user: user }); } catch (error) { console.error('Login error:', error); res.status(500).json({ message: 'Internal server error' }); } });

// --- NEW: Password Reset Endpoints ---
app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const userResult = await db.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userResult.rows.length === 0) {
            console.log(`Password reset requested for non-existent email: ${email}`);
            return res.status(200).json({ message: 'If an account with this email exists, a password reset link has been sent.' });
        }
        const user = userResult.rows[0];
        const rawToken = crypto.randomBytes(32).toString('hex');
        const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
        const tokenExpires = new Date(Date.now() + 3600000); // 1 hour
        await db.query(
            'UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
            [hashedToken, tokenExpires, user.id]
        );
        const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${rawToken}`;
        const recipients = [new Recipient(user.email, user.name)];
        const emailParams = new EmailParams()
            .setFrom(sentFrom)
            .setTo(recipients)
            .setSubject('Your PlantMaint Pro Password Reset')
            .setHtml(`
                <p>Hello ${user.name},</p>
                <p>You requested a password reset for your PlantMaint Pro account.</p>
                <p>Please click the link below to set a new password. This link will expire in 1 hour.</p>
                <a href="${resetUrl}" target="_blank" style="padding: 10px 15px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Reset Your Password</a>
                <p>If you did not request this, please ignore this email.</p>
            `);
        await mailerSend.email.send(emailParams);
        console.log(`Password reset link sent to: ${user.email}`);
        res.status(200).json({ message: 'If an account with this email exists, a password reset link has been sent.' });
    } catch (error) {
        console.error('Error in /forgot-password endpoint:', error);
        if (error.response) {
            console.error('MailerSend Error Body:', error.response.body);
        }
        res.status(500).json({ message: 'An internal error occurred.' });
    }
});
app.post('/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;
    if (!isPasswordStrong(newPassword)) {
        return res.status(400).json({ message: WEAK_PASSWORD_MESSAGE });
    }
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    try {
        const userResult = await db.query(
            'SELECT * FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()',
            [hashedToken]
        );
        if (userResult.rows.length === 0) {
            console.log('Invalid or expired password reset token attempted.');
            return res.status(400).json({ message: 'Password reset token is invalid or has expired.' });
        }
        const user = userResult.rows[0];
        const passwordHash = await bcrypt.hash(newPassword, 10);
        await db.query(
            'UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
            [passwordHash, user.id]
        );
        console.log(`Password successfully reset for user: ${user.email}`);
        res.status(200).json({ message: 'Password has been reset successfully.' });
    } catch (error) {
        console.error('Error in /reset-password endpoint:', error);
        res.status(500).json({ message: 'An internal error occurred.' });
    }
});
// --- END NEW PASSWORD RESET ENDPOINTS ---


// --- PROTECTED API ENDPOINTS ---
const ALL_ROLES = ['Maintenance Manager', 'Supervisor', 'Maintenance Technician', 'Operator'];
const MANAGER_AND_SUPERVISOR = ['Maintenance Manager', 'Supervisor'];
const MANAGER_ONLY = ['Maintenance Manager'];

// User Management
// (GET /users is 100% UNCHANGED)
app.get('/users', authenticateToken, authorize(MANAGER_AND_SUPERVISOR), async (req, res) => { try { const { companyId } = req.user; const result = await db.query('SELECT id, name, email, role, phone_number FROM users WHERE company_id = $1 ORDER BY name ASC', [companyId]); res.json(result.rows); } catch (error) { console.error('Error fetching users:', error); res.status(500).json({ message: 'Internal server error' }); } });

// (POST /users is 100% UNCHANGED from last file)
app.post('/users', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { 
    try { 
        const { name, email, password, role, phoneNumber } = req.body; 
        const { companyId } = req.user; 
        if (!isPasswordStrong(password)) {
            return res.status(400).json({ message: WEAK_PASSWORD_MESSAGE });
        }
        const passwordHash = await bcrypt.hash(password, 10); 
        const formattedPhoneNumber = phoneNumber ? `whatsapp:+${phoneNumber.replace(/[^0-9]/g, '')}` : null; 
        const result = await db.query(`INSERT INTO users (company_id, name, email, password_hash, role, phone_number) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, email, role, phone_number`, [companyId, name, email, passwordHash, role, formattedPhoneNumber]); 
        res.status(201).json({ message: 'User created!', user: result.rows[0] }); 
    } catch (error) { 
        if (error.code === '23505') { 
            return res.status(400).json({ message: 'Error: Email or phone number already in use.' }); 
        } 
        console.error('Error creating user:', error); 
        res.status(500).json({ message: 'Internal server error' }); 
    } 
});

// (GET /templates/users is 100% UNCHANGED)
app.get('/templates/users', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const workbook = new excel.Workbook(); const worksheet = workbook.addWorksheet('Users'); worksheet.columns = [ { header: 'Full Name (Required)', key: 'name', width: 30 }, { header: 'Email (Required)', key: 'email', width: 30 }, { header: 'Initial Password (Required)', key: 'password', width: 30 }, { header: 'Role (Required)', key: 'role', width: 25 }, { header: 'Phone Number (Optional, e.g., 254...)', key: 'phone', width: 25, numFmt: '@' } ]; worksheet.dataValidations.add('D2:D1000', { type: 'list', allowBlank: false, formulae: ['"Maintenance Manager,Supervisor,Maintenance Technician,Operator"'], showErrorMessage: true, errorTitle: 'Invalid Role', error: 'Please select a valid role from the dropdown list' }); const instructionsSheet = workbook.addWorksheet('Instructions'); instructionsSheet.mergeCells('A1:B5'); instructionsSheet.getCell('A1').value = 'Instructions:\n1. Do not change the column headers in the "Users" sheet.\n2. All columns are required except for Phone Number.\n3. For the "Role" column, please select a value from the dropdown list.\n4. Phone Number must include the country code (e.g., 254...)'; instructionsSheet.getCell('A1').alignment = { wrapText: true, vertical: 'top' }; res.setHeader( 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ); res.setHeader( 'Content-Disposition', 'attachment; filename="users_template.xlsx"' ); await workbook.xlsx.write(res); res.end(); } catch (error) { console.error('Error generating user template:', error); res.status(500).json({ message: 'Error generating template' }); } });

// (POST /users/upload is 100% UNCHANGED from last file)
app.post('/users/upload', authenticateToken, authorize(MANAGER_ONLY), upload.single('file'), async (req, res) => { 
    if (!req.file) { 
        return res.status(400).json({ message: 'No file uploaded.' }); 
    } 
    const { companyId } = req.user; 
    const workbook = new excel.Workbook(); 
    try { 
        await workbook.xlsx.load(req.file.buffer); 
        const worksheet = workbook.getWorksheet('Users'); 
        if (!worksheet) { 
            return res.status(400).json({ message: 'Invalid template: "Users" worksheet not found.' }); 
        } 
        let addedCount = 0; 
        let errorCount = 0; 
        let errors = []; 
        const newUsers = []; 
        const saltRounds = 10; 
        for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) { 
            const row = worksheet.getRow(rowNumber); 
            const name = row.getCell('A').value; 
            const emailCell = row.getCell('B').value; 
            const email = (emailCell && typeof emailCell === 'object' && emailCell.text) ? emailCell.text : emailCell; 
            const password = row.getCell('C').value; 
            const role = row.getCell('D').value; 
            const phoneNumber = row.getCell('E').value; 
            
            if (!name || !email || !password || !role) { 
                console.error(`Row ${rowNumber}: Skipping row due to missing required fields.`); 
                errors.push(`Row ${rowNumber}: Missing required fields.`); 
                errorCount++; 
                continue; 
            } 

            if (!isPasswordStrong(password.toString())) {
                console.error(`Row ${rowNumber}: Skipping row due to weak password.`);
                errors.push(`Row ${rowNumber} (${email}): ${WEAK_PASSWORD_MESSAGE}`);
                errorCount++;
                continue; 
            }

            try { 
                const passwordHash = await bcrypt.hash(password.toString(), saltRounds); 
                const formattedPhoneNumber = phoneNumber ? `whatsapp:+${phoneNumber.toString().replace(/[^0-9]/g, '')}` : null; 
                const result = await db.query( `INSERT INTO users (company_id, name, email, password_hash, role, phone_number) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, email, role, phone_number`, [companyId, name, email, passwordHash, role, formattedPhoneNumber] ); 
                newUsers.push(result.rows[0]); 
                addedCount++; 
            } catch (err) { 
                console.error(`Row ${rowNumber}: Failed to insert user "${email}":`, err.message); 
                errors.push(`Row ${rowNumber} (${email}): ${err.message}`); 
                errorCount++; 
            } 
        } 
        res.status(201).json({ message: `Upload complete: ${addedCount} users added, ${errorCount} rows failed.`, newUsers: newUsers, errors: errors }); 
    } catch (error) { 
        console.error('Error processing Excel file:', error); 
        res.status(500).json({ message: 'Error processing file.' }); 
    } 
});

// (PATCH /users/:id is 100% UNCHANGED)
app.patch('/users/:id', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { id } = req.params; const { name, email, role, phoneNumber } = req.body; const { companyId } = req.user; const formattedPhoneNumber = phoneNumber ? `whatsapp:+${phoneNumber.replace(/[^0-9]/g, '')}` : null; const result = await db.query(`UPDATE users SET name = $1, email = $2, role = $3, phone_number = $4 WHERE id = $5 AND company_id = $6 RETURNING id, name, email, role, phone_number`, [name, email, role, formattedPhoneNumber, id, companyId]); if (result.rows.length === 0) { return res.status(404).json({ message: "User not found." }); } res.json({ message: 'User updated!', user: result.rows[0] }); } catch (error) { if (error.code === '23505') { return res.status(400).json({ message: 'Error: Email or phone number already in use.' }); } console.error('Error updating user:', error); res.status(500).json({ message: 'Internal server error' }); } });
// (DELETE /users/:id is 100% UNCHANGED)
app.delete('/users/:id', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { id } = req.params; const { companyId, userId } = req.user; if (id == userId) { return res.status(403).json({ message: "You cannot delete your own account." }); } const result = await db.query('DELETE FROM users WHERE id = $1 AND company_id = $2', [id, companyId]); if (result.rowCount === 0) { return res.status(404).json({ message: "User not found." }); } res.status(200).json({ message: 'User deleted.' }); } catch (error) { console.error('Error deleting user:', error); res.status(500).json({ message: 'Internal server error' }); } });

// --- (All other routes: Machine, Breakdown, Utility, Dashboard, etc. are 100% UNCHANGED) ---
// Machine Management
app.get('/machines', authenticateToken, authorize(ALL_ROLES), async (req, res) => { try { const { companyId } = req.user; const result = await db.query('SELECT * FROM machines WHERE company_id = $1 ORDER BY name ASC', [companyId]); res.json(result.rows); } catch (error) { console.error('Error fetching machines:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.get('/templates/equipment', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const workbook = new excel.Workbook(); const worksheet = workbook.addWorksheet('Equipment'); worksheet.columns = [ { header: 'Machine Name (Required)', key: 'name', width: 30 }, { header: 'Location (Optional)', key: 'location', width: 30 } ]; const instructionsSheet = workbook.addWorksheet('Instructions'); instructionsSheet.mergeCells('A1:B5'); instructionsSheet.getCell('A1').value = 'Instructions:\n1. Do not change the column headers in the "Equipment" sheet.\n2. "Machine Name" is required for every row.\n3. "Location" is optional.\n4. Save this file and upload it on the "Equipment" page.'; instructionsSheet.getCell('A1').alignment = { wrapText: true, vertical: 'top' }; res.setHeader( 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ); res.setHeader( 'Content-Disposition', 'attachment; filename="equipment_template.xlsx"' ); await workbook.xlsx.write(res); res.end(); } catch (error) { console.error('Error generating equipment template:', error); res.status(500).json({ message: 'Error generating template' }); } });
app.post('/machines/upload', authenticateToken, authorize(MANAGER_ONLY), upload.single('file'), async (req, res) => { if (!req.file) { return res.status(400).json({ message: 'No file uploaded.' }); } const { companyId } = req.user; const workbook = new excel.Workbook(); try { await workbook.xlsx.load(req.file.buffer); const worksheet = workbook.getWorksheet('Equipment'); if (!worksheet) { return res.status(400).json({ message: 'Invalid template: "Equipment" worksheet not found.' }); } let addedCount = 0; let errorCount = 0; let errors = []; const newMachines = []; for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) { const row = worksheet.getRow(rowNumber); const machineName = row.getCell('A').value; const location = row.getCell('B').value || null; if (machineName) { try { const result = await db.query( 'INSERT INTO machines (company_id, name, location) VALUES ($1, $2, $3) RETURNING *', [companyId, machineName, location] ); newMachines.push(result.rows[0]); addedCount++; } catch (err) { console.error(`Failed to insert machine "${machineName}":`, err.message); errors.push(`Row ${rowNumber}: ${err.message}`); errorCount++; } } } res.status(201).json({ message: `Upload complete: ${addedCount} machines added, ${errorCount} rows failed.`, newMachines: newMachines, errors: errors }); } catch (error) { console.error('Error processing Excel file:', error); res.status(500).json({ message: 'Error processing file.' }); } });
app.post('/machines', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { name, location } = req.body; const { companyId } = req.user; const result = await db.query('INSERT INTO machines (company_id, name, location) VALUES ($1, $2, $3) RETURNING *', [companyId, name, location]); res.status(201).json({ message: 'Machine created!', machine: result.rows[0] }); } catch (error) { console.error('Error creating machine:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.patch('/machines/:id', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { id } = req.params; const { name, location } = req.body; const { companyId } = req.user; const result = await db.query('UPDATE machines SET name = $1, location = $2 WHERE id = $3 AND company_id = $4 RETURNING *', [name, location, id, companyId]); if (result.rows.length === 0) { return res.status(404).json({ message: 'Machine not found.' }); } res.json({ message: 'Machine updated!', machine: result.rows[0] }); } catch (error) { console.error('Error updating machine:', error); res.status(500).json({ message: 'Internal server error' }); } });

// --- FIXED TYPO IN THIS ROUTE ---
app.delete('/machines/:id', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { 
    try { 
        const { id } = req.params; 
        const { companyId } = req.user; 
        const result = await db.query('DELETE FROM machines WHERE id = $1 AND company_id = $2', [id, companyId]); 
        if (result.rowCount === 0) { 
            // --- THIS LINE IS FIXED ---
            return res.status(404).json({ message: 'Machine not found.' }); 
        } 
        res.status(200).json({ message: 'Machine deleted.' }); 
    } catch (error) { 
        if (error.code === '23503') { 
            return res.status(400).json({ message: 'Cannot delete machine. It is linked to other records.' }); 
        } 
        console.error('Error deleting machine:', error); 
        res.status(500).json({ message: 'Internal server error' }); 
    } 
});
// --- END FIX ---

// Breakdown Management
app.get('/breakdowns', authenticateToken, authorize(ALL_ROLES), async (req, res) => { try { const { companyId } = req.user; const query = ` SELECT b.id, b.description, b.status, b.reported_at, m.name AS machine_name, m.location AS machine_location FROM breakdowns b JOIN machines m ON b.machine_id = m.id WHERE b.company_id = $1 AND b.status != 'Closed' ORDER BY b.reported_at ASC `; const result = await db.query(query, [companyId]); res.json(result.rows); } catch (error) { console.error('Error fetching breakdowns:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.post('/breakdowns', authenticateToken, authorize(ALL_ROLES), async (req, res) => { try { const { machineId, description } = req.body; const { userId, companyId } = req.user; const result = await db.query('INSERT INTO breakdowns (machine_id, company_id, reported_by_id, description) VALUES ($1, $2, $3, $4) RETURNING *', [machineId, companyId, userId, description]); const newBreakdown = result.rows[0]; sendBreakdownApprovalRequest(newBreakdown.id, companyId); res.status(201).json({ message: 'Breakdown submitted for approval!', breakdown: newBreakdown }); } catch (error) { console.error('Error reporting breakdown:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.patch('/breakdowns/:id/status', authenticateToken, authorize(MANAGER_AND_SUPERVISOR), async (req, res) => { try { const { id } = req.params; const { status } = req.body; const { companyId } = req.user; const result = await db.query( "UPDATE breakdowns SET status = $1 WHERE id = $2 AND company_id = $3 RETURNING *", [status, id, companyId] ); if (result.rows.length === 0) { return res.status(404).json({ message: 'Breakdown not found.' }); } res.json({ message: 'Status updated!', breakdown: result.rows[0] }); } catch (error) { console.error('Error updating status:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.get('/reports/breakdowns', authenticateToken, authorize(MANAGER_AND_SUPERVISOR), async (req, res) => { try { const { companyId } = req.user; const query = ` SELECT b.id, b.status, b.description, m.name as machine_name, u_rep.name as reported_by, b.reported_at, u_app.name as approved_by, b.approved_at, u_ass.name as assigned_to, b.resolved_at, b.manager_acknowledged_at FROM breakdowns b JOIN machines m ON b.machine_id = m.id JOIN users u_rep ON b.reported_by_id = u_rep.id LEFT JOIN users u_app ON b.approved_by_id = u_app.id LEFT JOIN users u_ass ON b.assigned_to_id = u_ass.id WHERE b.company_id = $1 ORDER BY b.reported_at DESC `; const { rows } = await db.query(query, [companyId]); const workbook = new excel.Workbook(); const worksheet = workbook.addWorksheet('Breakdown Report'); worksheet.columns = [ { header: 'ID', key: 'id', width: 10 }, { header: 'Status', key: 'status', width: 20 }, { header: 'Machine', key: 'machine_name', width: 30 }, { header: 'Description', key: 'description', width: 50 }, { header: 'Reported By', key: 'reported_by', width: 25 }, { header: 'Reported At', key: 'reported_at', width: 25, style: { numFmt: 'yyyy-mm-dd hh:mm:ss' } }, { header: 'Approved By', key: 'approved_by', width: 25 }, { header: 'Assigned To', key: 'assigned_to', width: 25 }, { header: 'Resolved At', key: 'resolved_at', width: 25, style: { numFmt: 'yyyy-mm-dd hh:mm:ss' } }, { header: 'Manager Acknowledged', key: 'manager_acknowledged_at', width: 25, style: { numFmt: 'yyyy-mm-dd hh:mm:ss' } } ]; worksheet.addRows(rows); res.setHeader( 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ); res.setHeader( 'Content-Disposition', `attachment; filename="breakdown_report_${new Date().toISOString().split('T')[0]}.xlsx"` ); await workbook.xlsx.write(res); res.end(); } catch (error) { console.error('Error generating breakdown report:', error); res.status(500).json({ message: 'Error generating report' }); } });
// Utility Management
app.get('/utilities', authenticateToken, authorize(ALL_ROLES), async (req, res) => { try { const { companyId } = req.user; const result = await db.query('SELECT * FROM utilities WHERE company_id = $1', [companyId]); res.json(result.rows); } catch (error) { console.error('Error fetching utilities:', error); res.status(500).json({ message: 'Internal server error' }); } });
app.post('/utilities', authenticateToken, authorize(MANAGER_ONLY), async (req, res) => { try { const { name, unit, keyword } = req.body; const { companyId } = req.user; const result = await db.query('INSERT INTO utilities (company_id, name, unit, keyword) VALUES ($1, $2, $3, $4) RETURNING *', [companyId, name, unit, keyword ? keyword.toLowerCase() : null]); res.status(201).json({ message: 'Utility created!', utility: result.rows[0] }); } catch (error) { console.error('Error creating utility:', error); res.status(500).json({ message: 'Internal server error' }); } });
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

// --- FIXED TYPO IN THIS ROUTE ---
app.get('/inspections', authenticateToken, authorize(MANAGER_AND_SUPERVISOR), async (req, res) => { 
    try { 
        const { companyId } = req.user; 
        const query = ` SELECT ins.*, m.name as machine_name, u.name as inspected_by_name FROM machine_inspections ins JOIN machines m ON ins.machine_id = m.id JOIN users u ON ins.inspected_by_id = u.id WHERE ins.company_id = $1 ORDER BY ins.inspected_at DESC `; 
        const result = await db.query(query, [companyId]); 
        res.json(result.rows); 
    } catch (error) { 
        console.error('Error fetching machine inspections:', error); 
        // --- THIS LINE IS FIXED ---
        res.status(500).json({ message: 'Internal server error' }); 
    } 
});
// --- END FIX ---

app.post('/inspections', authenticateToken, authorize(ALL_ROLES), async (req, res) => { try { const { machineId, status, remarks } = req.body; const { userId, companyId } = req.user; if (!machineId || !status) { return res.status(400).json({ message: 'Machine ID and status are required.' }); } if (status === 'Not Okay' && !remarks) { return res.status(400).json({ message: 'Remarks are required if status is "Not Okay".' }); } const result = await db.query( `INSERT INTO machine_inspections (machine_id, company_id, inspected_by_id, status, remarks) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [machineId, companyId, userId, status, remarks || null] ); res.status(201).json({ message: 'Inspection logged successfully!', inspection: result.rows[0] }); } catch (error) { console.error('Error logging inspection:', error); res.status(500).json({ message: 'Internal server error' }); } });

// --- AUTOMATED BACKGROUND JOBS ---
// (This cron job is 100% UNCHANGED)
cron.schedule('0 8 * * *', async () => {
    console.log('Running daily check for PM task reminders...');
    try {
        const tasksToRemind = await db.query(
            `SELECT pmt.id, pmt.task_description, pmt.next_due_date, m.name as machine_name, pmt.company_id
             FROM preventive_maintenance_tasks pmt
             JOIN machines m ON pmt.machine_id = m.id
             WHERE pmt.next_due_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '3 days')
               AND (pmt.last_performed_at IS NULL OR pmt.last_performed_at < (pmt.next_due_date - pmt.frequency_days * INTERVAL '1 day'))`
        );
        if (tasksToRemind.rows.length === 0) {
            console.log('No PM tasks due for reminders today.');
            return;
        }
        console.log(`Found ${tasksToRemind.rows.length} PM tasks due soon.`);
        const tasksByCompany = {};
        for (const task of tasksToRemind.rows) {
            if (!tasksByCompany[task.company_id]) {
                tasksByCompany[task.company_id] = [];
            }
            tasksByCompany[task.company_id].push(task);
        }
        for (const [companyId, tasks] of Object.entries(tasksByCompany)) {
            const recipients = await db.query(
                `SELECT id, phone_number FROM users WHERE company_id = $1 AND role IN ('Maintenance Manager', 'Maintenance Technician', 'Supervisor')`,
                [companyId]
            );
            if (recipients.rows.length > 0) {
                let reminderMessage = "🔔 Preventive Maintenance Reminder 🔔\nThe following tasks are due soon:\n\n";
                tasks.forEach(task => {
                    reminderMessage += `*${new Date(task.next_due_date).toLocaleDateString()}* - ${task.machine_name}:\n  ${task.task_description}\n\n`;
                });
                const messagesToSend = recipients.rows
                    .filter(r => r.phone_number)
                    .map(r => ({
                        to: r.phone_number.replace('whatsapp:+', ''),
                        text: reminderMessage,
                        recipientId: r.id
                    }));
                if(messagesToSend.length > 0) {
                   await sendBulkWhatsAppMessages(messagesToSend);
                   console.log(`Sent PM reminders to ${messagesToSend.length} users for company ${companyId}.`);
                }
            }
        }
    } catch (error) {
        console.error("Error running PM reminder cron job:", error);
    }
}, {
    scheduled: true,
    timezone: "Africa/Nairobi" 
});

// --- SERVER STARTUP ---
app.listen(PORT, () => {
  // Update version number for clarity
  console.log(`>>>> BACKEND SERVER VERSION 2.2 (Forgot Password) IS RUNNING SUCCESSFULLY ON PORT ${PORT} <<<<`);
});