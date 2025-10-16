const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

// Only initialize the client if the credentials are provided
const client = (accountSid && authToken) ? require('twilio')(accountSid, authToken) : null;

async function sendBulkWhatsAppMessages(messages) {
  if (!client) {
    console.error("Twilio client not initialized. Check your TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN secrets.");
    // Return a failed status for all messages
    return messages.map(msg => ({ ...msg, status: 'failed', error: 'Twilio client not initialized' }));
  }

  console.log(`Preparing to send ${messages.length} messages via Twilio.`);
  
  const promises = messages.map(message => {
    const fullRecipientNumber = `whatsapp:${message.to}`;
    console.log(`Sending Twilio message to ${fullRecipientNumber}`);
    
    return client.messages.create({
       from: twilioPhoneNumber,
       to: fullRecipientNumber,
       body: message.text
    })
    .then(msg => {
        console.log(`Message sent to ${fullRecipientNumber} with SID: ${msg.sid}`);
        return { to: message.to, status: 'sent', text: message.text, recipientId: message.recipientId };
    })
    .catch(err => {
      console.error(`Failed to send to ${message.to}:`, err.message);
      return { to: message.to, status: 'failed', text: message.text, recipientId: message.recipientId, error: err.message };
    });
  });

  return Promise.all(promises);
}

module.exports = { sendBulkWhatsAppMessages };