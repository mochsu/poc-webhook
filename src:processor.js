// ─────────────────────────────────────────────────────
// src/processor.js — Message Processor (PostgreSQL + Vision)
// ─────────────────────────────────────────────────────

const whatsapp = require('./whatsapp');
const db       = require('./db/operations');
const yt       = require('./youtube');
const contract = require('./contract');
const vision   = require('./vision');

// ── Entry point ───────────────────────────────────────
async function processIncomingMessage(from, message) {
  const worker = await db.getWorker(from);

  if (message.type === 'video') {
    await handleVideo(from, message, worker);
  } else if (message.type === 'text') {
    await handleText(from, message.text.body, worker);
  } else {
    if (worker) {
      await whatsapp.sendText(from, 'Please send a video. Type HELP for instructions.');
    }
  }
}

// ════════════════════════════════════════════════════
//  VIDEO HANDLER
// ════════════════════════════════════════════════════

async function handleVideo(from, message, worker) {
  const { childId, stage } = whatsapp.parseCaption(message);

  // Unknown sender
  if (!worker) {
    await whatsapp.sendText(from,
      '👋 Your number is not registered with Proof of Care.\n\n' +
      'To register, send a video of yourself saying:\n' +
      '• Your full name\n• Your village\n• The programme you work with\n\n' +
      'Mal will review and confirm within 24 hours.'
    );
    return;
  }

  // Send immediate acknowledgement — don't make them wait in silence
  await whatsapp.sendText(from, `⏳ Received your video. Processing... (about 1 minute)`);

  let videoBuffer, aiResult, youtubeId;

  try {
    // 1. Download video from Meta
    videoBuffer = await whatsapp.downloadVideo(message.video.id);

    // 2. Run AI vision analysis
    aiResult = await vision.analyseVideo(videoBuffer, stage);

    // 3. Quality check
    const check = vision.qualityCheck(aiResult, stage);
    if (!check.passed) {
      await whatsapp.sendText(from,
        `❌ Video not accepted: ${check.reason}\n\nPlease film again and resend.`
      );
      await db.logSubmission({
        workerPhone: from, childId, stage,
        status: 'REJECTED', aiResult,
        errorMessage: check.reason
      });
      return;
    }

    // 4. Route to correct handler
    switch (stage) {
      case 'BEFORE':
        await handleBefore(from, worker, videoBuffer, aiResult);
        break;
      case 'DURING':
        if (!childId) {
          await whatsapp.sendText(from,
            '❌ Please include the child ID in your caption.\n' +
            'Example: "TZ-11156 DURING"'
          );
          return;
        }
        await handleDuring(from, worker, videoBuffer, aiResult, childId);
        break;
      case 'AFTERCARE':
        if (!childId) { await whatsapp.sendText(from, '❌ Include child ID: "TZ-11156 AFTERCARE"'); return; }
        await handleAftercare(from, worker, videoBuffer, aiResult, childId);
        break;
      case 'HOME':
        if (!childId) { await whatsapp.sendText(from, '❌ Include child ID: "TZ-11156 HOME"'); return; }
        await handleHome(from, worker, videoBuffer, aiResult, childId);
        break;
      default:
        await whatsapp.sendText(from,
          '❓ Not sure what stage this is.\n\n' +
          'Use these captions:\n' +
          '• (no caption) = BEFORE video\n' +
          '• "TZ-11156 DURING" = surgery proof\n' +
          '• "TZ-11156 AFTERCARE" = aftercare proof\n' +
          '• "TZ-11156 HOME" = home video\n\n' +
          'Type HELP for full instructions.'
        );
    }

  } catch (err) {
    console.error(`Error processing video from ${from}:`, err);
    await whatsapp.sendText(from,
      '⚠️ Something went wrong. Please try again.\n' +
      'If this keeps happening, contact Mal directly.'
    );
    await db.logSubmission({
      workerPhone: from, childId, stage,
      status: 'REJECTED', aiResult,
      errorMessage: err.message
    });
  }
}

// ── BEFORE ────────────────────────────────────────────
async function handleBefore(from, worker, videoBuffer, aiResult) {
  // Duplicate face check
  const faceHash  = vision.generateFaceHash(aiResult);
  const duplicate = await db.faceHashExists(faceHash);
  if (duplicate) {
    await whatsapp.sendText(from,
      `⚠️ This child may already be registered (ID: ${duplicate}).\n` +
      `Please check with Mal before registering again.`
    );
    return;
  }

  // Get next child ID
  const countryCode = worker.country || 'TZ';
  const childId     = await db.getNextChildId(countryCode);

  // Upload to YouTube
  youtubeId = await yt.uploadVideo({
    videoBuffer,
    title:       yt.buildVideoTitle(childId, 'BEFORE'),
    description: `Proof of Care BEFORE video. Child: ${childId}. Worker: ${worker.worker_code}.`,
    tags:        [childId, 'BEFORE', 'ProofOfCare', worker.worker_code]
  });

  // Save to database
  await db.registerChild({
    childId,
    country:      countryCode,
    diagnosisCode: aiResult.diagnosis_hint || 'TBC',
    demographics: `${aiResult.subject_sex_estimate?.[0]?.toUpperCase() || 'U'}${aiResult.subject_age_estimate}`,
    workerPhone:  from,
    beforeVideoId: youtubeId,
    faceHash
  });

  if (faceHash) {
    await db.storeFaceHash(childId, faceHash, aiResult.confidence);
  }

  // Register on blockchain (non-blocking — doesn't fail the whole submission)
  try {
    const { outcomeId, chainHash } = await contract.registerChild({
      childId,
      country:      countryCode,
      diagnosisCode: 'TBC',
      demographics: 'TBC',
      workerWallet: worker.wallet
    });
    await contract.submitOutreachProof({
      outcomeId,
      workerCode:     worker.worker_code,
      youtubeVideoId: youtubeId
    });
    await db.setOutcomeId(childId, outcomeId, chainHash);
  } catch (contractErr) {
    console.warn('Contract call non-fatal:', contractErr.message);
  }

  // Update worker stats
  await db.incrementWorkerCases(from);

  // Log the submission
  await db.logSubmission({
    workerPhone: from, childId, stage: 'BEFORE',
    videoId: youtubeId, status: 'APPROVED', aiResult
  });

  // Reply to worker
  await whatsapp.sendText(from,
    `✅ Child registered!\n\n` +
    `*Child ID: ${childId}*\n` +
    `Video: saved ✓\n` +
    `AI check: passed ✓\n\n` +
    `Your payment: $90 locked until child is home.\n\n` +
    `Mal will review and confirm. You will receive the child ID and further instructions shortly.\n\n` +
    `Type "STATUS ${childId}" to check progress anytime.`
  );

  console.log(`\n✅ BEFORE complete: ${childId} by ${worker.worker_code}\n`);
}

// ── DURING ────────────────────────────────────────────
async function handleDuring(from, worker, videoBuffer, aiResult, childId) {
  const child = await db.getChild(childId);
  if (!child) {
    await whatsapp.sendText(from, `❌ Child ID ${childId} not found. Check the ID and try again.`);
    return;
  }

  youtubeId = await yt.uploadVideo({
    videoBuffer,
    title:       yt.buildVideoTitle(childId, 'DURING'),
    description: `POC DURING video. Child: ${childId}. Worker: ${worker.worker_code}.`,
    tags:        [childId, 'DURING', 'ProofOfCare']
  });

  await db.updateChildStage(childId, 'SURGERY_PROVEN', youtubeId);

  if (child.outcome_id) {
    try {
      await contract.submitSurgeryProof({
        outcomeId:      child.outcome_id,
        hospitalCode:   worker.worker_code,
        surgeonCode:    'ELI',
        procedureCode:  child.diagnosis_code || 'GEN',
        youtubeVideoId: youtubeId
      });
    } catch (e) { console.warn('Contract DURING:', e.message); }
  }

  await db.logSubmission({
    workerPhone: from, childId, stage: 'DURING',
    videoId: youtubeId, status: 'APPROVED', aiResult
  });

  await whatsapp.sendText(from,
    `✅ Surgery proof accepted for *${childId}*\n\n` +
    `DURING video logged ✓\n\n` +
    `Next: film the AFTERCARE video when the child arrives at the recovery facility.\n` +
    `Caption: "${childId} AFTERCARE"`
  );

  console.log(`\n✅ DURING complete: ${childId}\n`);
}

// ── AFTERCARE ─────────────────────────────────────────
async function handleAftercare(from, worker, videoBuffer, aiResult, childId) {
  const child = await db.getChild(childId);
  if (!child) {
    await whatsapp.sendText(from, `❌ Child ID ${childId} not found.`);
    return;
  }

  youtubeId = await yt.uploadVideo({
    videoBuffer,
    title:       yt.buildVideoTitle(childId, 'AFTERCARE'),
    description: `POC AFTERCARE video. Child: ${childId}.`,
    tags:        [childId, 'AFTERCARE', 'ProofOfCare']
  });

  await db.updateChildStage(childId, 'AFTERCARE_PROVEN', youtubeId);

  if (child.outcome_id) {
    try {
      await contract.submitAftercareProof({
        outcomeId:      child.outcome_id,
        locationCode:   'ZIL',
        nurseCode:      worker.worker_code,
        aftercareDays:  14,
        youtubeVideoId: youtubeId
      });
    } catch (e) { console.warn('Contract AFTERCARE:', e.message); }
  }

  await db.logSubmission({
    workerPhone: from, childId, stage: 'AFTERCARE',
    videoId: youtubeId, status: 'APPROVED', aiResult
  });

  await whatsapp.sendText(from,
    `✅ Aftercare proof accepted for *${childId}*\n\n` +
    `When the child is ready to go home, film the HOME video.\n` +
    `Caption: "${childId} HOME"\n\n` +
    `This is the final video. Your payment releases after this.`
  );
}

// ── HOME ──────────────────────────────────────────────
async function handleHome(from, worker, videoBuffer, aiResult, childId) {
  const child = await db.getChild(childId);
  if (!child) {
    await whatsapp.sendText(from, `❌ Child ID ${childId} not found.`);
    return;
  }

  youtubeId = await yt.uploadVideo({
    videoBuffer,
    title:       yt.buildVideoTitle(childId, 'HOME'),
    description: `POC HOME video. Child: ${childId}. Worker: ${worker.worker_code}.`,
    tags:        [childId, 'HOME', 'ProofOfCare']
  });

  await db.updateChildStage(childId, 'HOME_CONFIRMED', youtubeId);

  if (child.outcome_id) {
    try {
      await contract.submitHomeProof({
        outcomeId:      child.outcome_id,
        youtubeVideoId: youtubeId
      });
    } catch (e) { console.warn('Contract HOME:', e.message); }
  }

  await db.logSubmission({
    workerPhone: from, childId, stage: 'HOME',
    videoId: youtubeId, status: 'APPROVED', aiResult
  });

  await whatsapp.sendText(from,
    `🎉 Home video accepted for *${childId}*!\n\n` +
    `Full chain complete:\n` +
    `BEFORE ✓  SURGERY ✓  AFTERCARE ✓  HOME ✓\n\n` +
    `Mal is verifying. Your payment will be sent to your Coinbase wallet within 48 hours.\n\n` +
    `Thank you. This child's journey is complete.`
  );

  console.log(`\n✅ HOME complete: ${childId} — AWAITING VERIFICATION\n`);
}

// ════════════════════════════════════════════════════
//  TEXT HANDLER
// ════════════════════════════════════════════════════

async function handleText(from, text, worker) {
  const upper = text.toUpperCase().trim();

  if (upper === 'HELP') {
    await sendHelp(from, worker);
  } else if (upper.startsWith('STATUS ')) {
    const childId = upper.replace('STATUS ', '').trim();
    await sendStatus(from, childId);
  } else if (upper.startsWith('REGISTER')) {
    await whatsapp.sendText(from,
      'To register: send a short video of yourself saying your name, village, and programme.\n' +
      'Mal will confirm within 24 hours.'
    );
  } else {
    if (worker) {
      await whatsapp.sendText(from, `Hello ${worker.name}. Send a video or type HELP.`);
    } else {
      await whatsapp.sendText(from,
        'Welcome to Proof of Care.\nYour number is not registered.\n' +
        'Send a video of yourself to register. Type HELP for instructions.'
      );
    }
  }
}

async function sendHelp(from, worker) {
  const info = worker
    ? `Registered: ${worker.worker_code} (${worker.name}) · Cases: ${worker.cases_total}\n\n`
    : 'Not registered.\n\n';

  await whatsapp.sendText(from,
    `📋 Proof of Care — Instructions\n\n${info}` +
    `NEW CHILD (no caption) → BEFORE video\n` +
    `TZ-11156 DURING → surgery proof\n` +
    `TZ-11156 AFTERCARE → aftercare proof\n` +
    `TZ-11156 HOME → home video + payment\n\n` +
    `Check a case: STATUS TZ-11156\n\n` +
    `Questions? Contact Mal.`
  );
}

async function sendStatus(from, childId) {
  const child = await db.getChild(childId);
  if (!child) {
    await whatsapp.sendText(from, `❌ ${childId} not found.`);
    return;
  }

  const chain = [
    child.before_video_id    ? '✅ BEFORE'    : '⏳ BEFORE (needed)',
    child.surgery_video_id   ? '✅ SURGERY'   : '⏳ SURGERY (needed)',
    child.aftercare_video_id ? '✅ AFTERCARE' : '⏳ AFTERCARE (needed)',
    child.home_video_id      ? '✅ HOME'      : '⏳ HOME (needed)'
  ].join('\n');

  await whatsapp.sendText(from,
    `📋 ${childId}\n\nStage: ${child.stage}\n\n${chain}`
  );
}

module.exports = { processIncomingMessage };
