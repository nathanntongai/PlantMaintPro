// backend/whatsappService.js
const axios = require('axios');

// Load credentials from the .env file
const WHATSAPP_TOKEN = process.env.META_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;

// The Meta Graph API endpoint for sending messages
const META_API_URL = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;

/**
 * Sends a text message to a WhatsApp number.
 * @param {string} to - The recipient's phone number (e.g., '254712345678').
 * @param {string} text - The message text to send.
 */
async function sendWhatsAppMessage(to, text) {
  console.log(`Sending message to ${to}: "${text}"`);
  try {
    await axios.post(
      META_API_URL,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: {
          body: text,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('Error sending WhatsApp message:', error.response ? error.response.data : error.message);
  }
}

module.exports = { sendWhatsAppMessage };