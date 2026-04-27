require('dotenv').config();
const express = require('express');
const { processIncomingMessage } = require('./src/processor');
const { pool } = require('./src/db/index');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// Auto-run migrations on startup
async function runMigrations() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS workers (
        id SERIAL PRIMARY KEY, phone TEXT UNIQUE NOT NULL,
        worker_code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'OUTREACH', trust_level TEXT NOT NULL DEFAULT 'NEW',
        wallet TEXT, rating DECIMAL(3,2) DEFAULT 0, cases_total INTEGER DEFAULT 0,
        cases_verified INTEGER DEFAULT 0, fraud_flags INTEGER DEFAULT 0,
        country TEXT DEFAULT 'TZ', notes TEXT,
        registered_at TIMESTAMP DEFAULT NOW(), last_active TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS children (
        id SERIAL PRIMARY KEY, child_id TEXT UNIQUE NOT NULL,
        outcome_id TEXT, country TEXT NOT NULL DEFAULT 'TZ',
        diagnosis_code TEXT, demographics TEXT, stage TEXT NOT NULL DEFAULT 'REGISTERED',
        worker_phone TEXT, before_video_id TEXT, surgery_video_id TEXT,
        aftercare_video_id TEXT, home_video_id TEXT, face_hash TEXT,
        donor_wallet TEXT, usdc_amount DECIMAL(10,2), chain_hash TEXT,
        star_rating INTEGER, notes TEXT, registered_at TIMESTAMP DEFAULT NOW(),
        surgery_at TIMESTAMP, home_at TIMESTAMP, paid_at TIMESTAMP
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS submissions (
        id SERIAL PRIMARY KEY, worker_phone TEXT, child_id TEXT,
        stage TEXT, video_id TEXT, status TEXT DEFAULT 'PENDING',
        ai_result JSONB, error_message TEXT,
        submitted_at TIMESTAMP DEFAULT NOW(), processed_at TIMESTAMP
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS face_hashes (
        id SERIAL PRIMARY KEY, child_id TEXT, face_hash TEXT NOT NULL,
        confidence DECIMAL(4,3), created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY, child_id TEXT, worker_phone TEXT,
        role TEXT, usdc_amount DECIMAL(10,2), tx_hash TEXT,
        status TEXT DEFAULT 'PENDING', paid_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✓ Database tables ready');
  } catch (err) {
    console.error('Migration error:', err.message);
  }
}

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('✓ Webhook verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;
    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return;
    const from = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
    console.log(`📱 Message from ${from}`);
    await processIncomingMessage(from, message);
  } catch (err) {
    console.error('Webhook error:', err);
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'POC Webhook running', time: new Date().toISOString() });
});

app.listen(PORT, async () => {
  console.log(`🚀 POC Webhook running on port ${PORT}`);
  await runMigrations();
});
