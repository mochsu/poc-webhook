// ─────────────────────────────────────────────────────
// src/db/migrate.js — Create all database tables
//
// Run once: node src/db/migrate.js
// Safe to re-run — uses CREATE TABLE IF NOT EXISTS
// ─────────────────────────────────────────────────────

require('dotenv').config();
const { query } = require('./index');

async function migrate() {
  console.log('Running database migrations...\n');

  // ── Workers table ─────────────────────────────────
  // One row per registered outreach worker / hospital actor
  await query(`
    CREATE TABLE IF NOT EXISTS workers (
      id            SERIAL PRIMARY KEY,
      phone         TEXT UNIQUE NOT NULL,
      worker_code   TEXT UNIQUE NOT NULL,
      name          TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'OUTREACH',
      -- OUTREACH | HOSPITAL | AFTERCARE | VERIFIER
      trust_level   TEXT NOT NULL DEFAULT 'NEW',
      -- NEW | LOW | MED | HIGH | SPOT_CHECK
      wallet        TEXT,
      rating        DECIMAL(3,2) DEFAULT 0,
      cases_total   INTEGER DEFAULT 0,
      cases_verified INTEGER DEFAULT 0,
      fraud_flags   INTEGER DEFAULT 0,
      country       TEXT DEFAULT 'TZ',
      notes         TEXT,
      registered_at TIMESTAMP DEFAULT NOW(),
      last_active   TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✓ workers table');

  // ── Children table ────────────────────────────────
  // One row per child outcome
  await query(`
    CREATE TABLE IF NOT EXISTS children (
      id              SERIAL PRIMARY KEY,
      child_id        TEXT UNIQUE NOT NULL,
      -- e.g. TZ-11156
      outcome_id      TEXT,
      -- blockchain outcomeId (bytes32)
      country         TEXT NOT NULL DEFAULT 'TZ',
      diagnosis_code  TEXT,
      demographics    TEXT,
      -- e.g. F03 (female, 3 years)
      stage           TEXT NOT NULL DEFAULT 'REGISTERED',
      -- REGISTERED | OUTREACH_PROVEN | DONOR_AUTHORISED |
      -- SURGERY_PROVEN | AFTERCARE_PROVEN | HOME_CONFIRMED |
      -- VERIFIED | PAID | FAILED
      worker_phone    TEXT REFERENCES workers(phone),
      before_video_id  TEXT,
      -- YouTube video ID
      surgery_video_id TEXT,
      aftercare_video_id TEXT,
      home_video_id    TEXT,
      face_hash        TEXT,
      -- AI-generated face hash for duplicate detection
      donor_wallet     TEXT,
      usdc_amount      DECIMAL(10,2),
      chain_hash       TEXT,
      -- latest blockchain chain hash
      star_rating      INTEGER,
      notes            TEXT,
      registered_at    TIMESTAMP DEFAULT NOW(),
      surgery_at       TIMESTAMP,
      home_at          TIMESTAMP,
      paid_at          TIMESTAMP
    );
  `);
  console.log('✓ children table');

  // ── Submissions log ───────────────────────────────
  // Every video submission — success or failure
  await query(`
    CREATE TABLE IF NOT EXISTS submissions (
      id            SERIAL PRIMARY KEY,
      worker_phone  TEXT,
      child_id      TEXT,
      stage         TEXT,
      -- BEFORE | DURING | AFTERCARE | HOME
      video_id      TEXT,
      -- YouTube video ID on success
      status        TEXT DEFAULT 'PENDING',
      -- PENDING | APPROVED | REJECTED | DUPLICATE
      ai_result     JSONB,
      -- full OpenAI analysis result
      error_message TEXT,
      submitted_at  TIMESTAMP DEFAULT NOW(),
      processed_at  TIMESTAMP
    );
  `);
  console.log('✓ submissions table');

  // ── Face hashes table ─────────────────────────────
  // AI-generated face hashes for duplicate detection
  await query(`
    CREATE TABLE IF NOT EXISTS face_hashes (
      id            SERIAL PRIMARY KEY,
      child_id      TEXT REFERENCES children(child_id),
      face_hash     TEXT NOT NULL,
      confidence    DECIMAL(4,3),
      created_at    TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_face_hashes_hash
      ON face_hashes(face_hash);
  `);
  console.log('✓ face_hashes table');

  // ── Payments log ──────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS payments (
      id            SERIAL PRIMARY KEY,
      child_id      TEXT REFERENCES children(child_id),
      worker_phone  TEXT REFERENCES workers(phone),
      role          TEXT,
      usdc_amount   DECIMAL(10,2),
      tx_hash       TEXT,
      -- blockchain transaction hash
      status        TEXT DEFAULT 'PENDING',
      -- PENDING | CONFIRMED | FAILED
      paid_at       TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✓ payments table');

  console.log('\n✅ All migrations complete.\n');
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
