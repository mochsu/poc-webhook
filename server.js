// ─────────────────────────────────────────────────────
// server.js — POC Webhook Entry Point
//
// This server does two things:
//   GET  /webhook  → verify the webhook with Meta (one-time setup)
//   POST /webhook  → receive WhatsApp messages and process them
// ─────────────────────────────────────────────────────

require('dotenv').config();
const express = require('express');
const { processIncomingMessage } = require('./src/processor');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ── Webhook Verification (Meta calls this once during setup) ──
// Meta sends a GET request with a challenge. We respond with
// the challenge to prove we own this URL.
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('✓ Webhook verified by Meta');
    res.status(200).send(challenge);
  } else {
    console.log('✗ Webhook verification failed — check WHATSAPP_VERIFY_TOKEN');
    res.sendStatus(403);
  }
});

// ── Receive Messages ──────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  // Always respond 200 immediately — Meta resends if no response within 20s
  res.sendStatus(200);

  try {
    const body = req.body;

    // Check this is a WhatsApp message event
    if (body.object !== 'whatsapp_business_account') return;

    const entry   = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value   = changes?.value;

    // Skip status updates (delivered/read receipts)
    if (!value?.messages || value.messages.length === 0) return;

    const message = value.messages[0];
    const from    = message.from; // sender's phone number

    console.log(`\n📱 Message received from ${from}`);
    console.log(`   Type: ${message.type}`);
    if (message.text)  console.log(`   Text: ${message.text.body}`);
    if (message.video) console.log(`   Video ID: ${message.video.id}`);

    // Hand off to the processor — this does all the work
    await processIncomingMessage(from, message);

  } catch (err) {
    console.error('Error processing webhook:', err);
  }
});

// ── Health check ──────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'POC Webhook running',
    time: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 POC Webhook server running on port ${PORT}`);
  console.log(`   Webhook URL: https://your-railway-url.up.railway.app/webhook`);
  console.log(`   Health check: https://your-railway-url.up.railway.app/\n`);
});
