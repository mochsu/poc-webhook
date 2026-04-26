// ─────────────────────────────────────────────────────
// src/whatsapp.js — Meta WhatsApp Cloud API
//
// Handles sending messages and downloading videos
// from the Meta Graph API.
// ─────────────────────────────────────────────────────

const axios = require('axios');

const API_URL = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}`;
const HEADERS = {
  'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
  'Content-Type': 'application/json'
};

// ── Send a plain text message ─────────────────────────
async function sendText(to, text) {
  try {
    await axios.post(`${API_URL}/messages`, {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text }
    }, { headers: HEADERS });
    console.log(`   ✓ Sent reply to ${to}`);
  } catch (err) {
    console.error('Failed to send WhatsApp message:', err.response?.data || err.message);
  }
}

// ── Get the download URL for a video ─────────────────
// Meta doesn't give you the video directly in the webhook.
// You have to request the URL separately, then download it.
async function getMediaUrl(mediaId) {
  const response = await axios.get(
    `https://graph.facebook.com/v18.0/${mediaId}`,
    { headers: HEADERS }
  );
  return response.data.url;
}

// ── Download a video to a Buffer ─────────────────────
async function downloadMedia(mediaUrl) {
  const response = await axios.get(mediaUrl, {
    headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}` },
    responseType: 'arraybuffer'
  });
  return Buffer.from(response.data);
}

// ── Download a video by its Meta media ID ────────────
async function downloadVideo(mediaId) {
  console.log(`   Downloading video ${mediaId}...`);
  const url    = await getMediaUrl(mediaId);
  const buffer = await downloadMedia(url);
  console.log(`   ✓ Video downloaded (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
  return buffer;
}

// ── Extract caption from video message ───────────────
// Workers include the stage and child ID in the video caption.
// Examples:
//   (no caption)        → BEFORE (new child)
//   "TZ-11156 DURING"   → DURING proof for that child
//   "TZ-11156 AFTERCARE"→ aftercare proof
//   "TZ-11156 HOME"     → home proof
function parseCaption(message) {
  const caption = message.video?.caption || message.image?.caption || '';
  const upper   = caption.toUpperCase().trim();

  // Extract child ID if present (format: TZ-12345 or similar)
  const childIdMatch = upper.match(/[A-Z]{2,}-\d+/);
  const childId = childIdMatch ? childIdMatch[0] : null;

  // Extract stage keyword
  let stage = 'BEFORE'; // default — new child registration
  if (upper.includes('DURING'))      stage = 'DURING';
  if (upper.includes('SURGERY'))     stage = 'DURING';
  if (upper.includes('AFTERCARE'))   stage = 'AFTERCARE';
  if (upper.includes('HOME'))        stage = 'HOME';
  if (upper.includes('REVIEW'))      stage = 'REVIEW';
  if (upper.includes('PROSTHETIC'))  stage = 'PROSTHETIC';

  return { childId, stage, rawCaption: caption };
}

module.exports = { sendText, downloadVideo, parseCaption };
