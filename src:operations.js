// ─────────────────────────────────────────────────────
// src/db/operations.js — All database operations
//
// Replaces sheets.js — same interface, PostgreSQL backend
// ─────────────────────────────────────────────────────

const { query } = require('./index');

// ════════════════════════════════════════════════════
//  WORKERS
// ════════════════════════════════════════════════════

// Look up a worker by phone number
async function getWorker(phone) {
  const normalised = normalisePhone(phone);
  const result = await query(
    'SELECT * FROM workers WHERE phone = $1 LIMIT 1',
    [normalised]
  );
  return result.rows[0] || null;
}

// Register a new worker
async function registerWorker({ phone, name, workerCode, role = 'OUTREACH', country = 'TZ' }) {
  const normalised = normalisePhone(phone);
  await query(`
    INSERT INTO workers (phone, worker_code, name, role, country, trust_level)
    VALUES ($1, $2, $3, $4, $5, 'NEW')
    ON CONFLICT (phone) DO NOTHING
  `, [normalised, workerCode, name, role, country]);
  console.log(`✓ Worker registered: ${workerCode}`);
}

// Update worker trust level after cases complete
async function updateWorkerTrust(phone, trustLevel) {
  await query(
    'UPDATE workers SET trust_level = $1 WHERE phone = $2',
    [trustLevel, normalisePhone(phone)]
  );
}

// Increment worker case count and update last active
async function incrementWorkerCases(phone) {
  await query(`
    UPDATE workers
    SET cases_total = cases_total + 1, last_active = NOW()
    WHERE phone = $1
  `, [normalisePhone(phone)]);
}

// Increment verified case count and update rating
async function recordVerifiedCase(phone, starRating) {
  await query(`
    UPDATE workers
    SET
      cases_verified = cases_verified + 1,
      rating = ((rating * cases_verified) + $1) / (cases_verified + 1),
      last_active = NOW()
    WHERE phone = $2
  `, [starRating, normalisePhone(phone)]);
}

// Flag a fraud attempt
async function flagFraud(phone) {
  await query(
    'UPDATE workers SET fraud_flags = fraud_flags + 1 WHERE phone = $1',
    [normalisePhone(phone)]
  );
}

// Get next worker code for a country
// e.g. TZ-145 → TZ-146
async function getNextWorkerCode(countryCode = 'TZ') {
  const result = await query(`
    SELECT worker_code FROM workers
    WHERE country = $1
    ORDER BY id DESC LIMIT 1
  `, [countryCode]);

  if (!result.rows[0]) return `${countryCode}-001`;

  const last = result.rows[0].worker_code;
  const num  = parseInt(last.split('-').pop()) || 0;
  return `${countryCode}-${String(num + 1).padStart(3, '0')}`;
}

// ════════════════════════════════════════════════════
//  CHILDREN
// ════════════════════════════════════════════════════

// Get a child by their ID
async function getChild(childId) {
  const result = await query(
    'SELECT * FROM children WHERE child_id = $1 LIMIT 1',
    [childId.toUpperCase().trim()]
  );
  return result.rows[0] || null;
}

// Register a new child
async function registerChild({
  childId, country, diagnosisCode, demographics,
  workerPhone, beforeVideoId, faceHash
}) {
  await query(`
    INSERT INTO children
      (child_id, country, diagnosis_code, demographics,
       worker_phone, before_video_id, face_hash, stage)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'REGISTERED')
  `, [
    childId, country, diagnosisCode || 'TBC',
    demographics || 'TBC',
    normalisePhone(workerPhone),
    beforeVideoId, faceHash
  ]);
  console.log(`✓ Child registered: ${childId}`);
}

// Update child stage and video ID
async function updateChildStage(childId, stage, videoId = null) {
  const videoColumn = {
    'OUTREACH_PROVEN':   'before_video_id',
    'SURGERY_PROVEN':    'surgery_video_id',
    'AFTERCARE_PROVEN':  'aftercare_video_id',
    'HOME_CONFIRMED':    'home_video_id'
  }[stage];

  let sql = 'UPDATE children SET stage = $1';
  const params = [stage];
  let i = 2;

  if (videoColumn && videoId) {
    sql += `, ${videoColumn} = $${i++}`;
    params.push(videoId);
  }

  if (stage === 'HOME_CONFIRMED') {
    sql += `, home_at = NOW()`;
  }
  if (stage === 'SURGERY_PROVEN') {
    sql += `, surgery_at = NOW()`;
  }
  if (stage === 'PAID') {
    sql += `, paid_at = NOW()`;
  }

  sql += ` WHERE child_id = $${i}`;
  params.push(childId.toUpperCase().trim());

  await query(sql, params);
  console.log(`✓ Child ${childId} → ${stage}`);
}

// Update outcome ID after blockchain registration
async function setOutcomeId(childId, outcomeId, chainHash) {
  await query(
    'UPDATE children SET outcome_id = $1, chain_hash = $2 WHERE child_id = $3',
    [outcomeId, chainHash, childId]
  );
}

// Get the next child ID number for a country
async function getNextChildId(countryCode = 'TZ') {
  const result = await query(`
    SELECT child_id FROM children
    WHERE country = $1
    ORDER BY id DESC LIMIT 1
  `, [countryCode]);

  if (!result.rows[0]) return `${countryCode}-11001`;

  const last = result.rows[0].child_id;
  const num  = parseInt(last.split('-').pop()) || 11000;
  return `${countryCode}-${num + 1}`;
}

// Check if a face hash already exists (duplicate detection)
async function faceHashExists(faceHash) {
  if (!faceHash) return false;
  const result = await query(
    'SELECT child_id FROM face_hashes WHERE face_hash = $1 LIMIT 1',
    [faceHash]
  );
  return result.rows.length > 0
    ? result.rows[0].child_id
    : false;
}

// Store a face hash
async function storeFaceHash(childId, faceHash, confidence) {
  await query(
    'INSERT INTO face_hashes (child_id, face_hash, confidence) VALUES ($1, $2, $3)',
    [childId, faceHash, confidence]
  );
}

// ════════════════════════════════════════════════════
//  SUBMISSIONS LOG
// ════════════════════════════════════════════════════

async function logSubmission({ workerPhone, childId, stage, videoId, status, aiResult, errorMessage }) {
  await query(`
    INSERT INTO submissions
      (worker_phone, child_id, stage, video_id, status, ai_result, error_message, processed_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
  `, [
    normalisePhone(workerPhone),
    childId,
    stage,
    videoId,
    status,
    aiResult ? JSON.stringify(aiResult) : null,
    errorMessage
  ]);
}

// ════════════════════════════════════════════════════
//  PAYMENTS LOG
// ════════════════════════════════════════════════════

async function logPayment({ childId, workerPhone, role, usdcAmount, txHash }) {
  await query(`
    INSERT INTO payments (child_id, worker_phone, role, usdc_amount, tx_hash, status)
    VALUES ($1, $2, $3, $4, $5, 'CONFIRMED')
  `, [childId, normalisePhone(workerPhone), role, usdcAmount, txHash]);
}

// ════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════

function normalisePhone(phone) {
  if (!phone) return '';
  return phone.replace(/\s/g, '').replace(/^00/, '+');
}

module.exports = {
  getWorker,
  registerWorker,
  updateWorkerTrust,
  incrementWorkerCases,
  recordVerifiedCase,
  flagFraud,
  getNextWorkerCode,
  getChild,
  registerChild,
  updateChildStage,
  setOutcomeId,
  getNextChildId,
  faceHashExists,
  storeFaceHash,
  logSubmission,
  logPayment
};
