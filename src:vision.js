// ─────────────────────────────────────────────────────
// src/vision.js — OpenAI Vision API
//
// Analyses proof videos by extracting a frame and
// running GPT-4 Vision on it.
//
// What it checks:
//  - Is there a visible human face?
//  - Is it consistent with a medical/disaster context?
//  - Approximate age and sex of the primary subject
//  - Is the background consistent with the claimed location?
//  - Generates a simple face descriptor for duplicate detection
// ─────────────────────────────────────────────────────

const OpenAI  = require('openai');
const { execSync } = require('child_process');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Analyse a video buffer ────────────────────────────
// Extracts a frame at 3 seconds and runs vision analysis
async function analyseVideo(videoBuffer, stage = 'BEFORE') {
  console.log(`   Running AI analysis (${stage})...`);

  // Write video to temp file
  const tmpDir   = os.tmpdir();
  const videoPath = path.join(tmpDir, `poc_${Date.now()}.mp4`);
  const framePath = path.join(tmpDir, `poc_${Date.now()}.jpg`);

  try {
    fs.writeFileSync(videoPath, videoBuffer);

    // Extract frame at 3 seconds using ffmpeg
    // ffmpeg is available on Railway/AWS by default
    try {
      execSync(`ffmpeg -i ${videoPath} -ss 00:00:03 -vframes 1 ${framePath} -y -loglevel quiet`);
    } catch {
      // If 3 seconds fails (short video), try 1 second
      execSync(`ffmpeg -i ${videoPath} -ss 00:00:01 -vframes 1 ${framePath} -y -loglevel quiet`);
    }

    const imageBuffer = fs.readFileSync(framePath);
    const base64Image = imageBuffer.toString('base64');

    // Run GPT-4 Vision
    const prompt = buildPrompt(stage);
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${base64Image}`,
              detail: 'low' // cheaper — enough for this purpose
            }
          }
        ]
      }]
    });

    const raw    = response.choices[0].message.content;
    const result = parseVisionResponse(raw);

    console.log(`   ✓ AI analysis complete:`, JSON.stringify(result));
    return result;

  } finally {
    // Clean up temp files
    try { fs.unlinkSync(videoPath); } catch {}
    try { fs.unlinkSync(framePath); } catch {}
  }
}

// ── Build the analysis prompt per stage ──────────────
function buildPrompt(stage) {
  const base = `You are a video verification assistant for a children's surgical aid programme in Africa.
Analyse this video frame and respond ONLY with a JSON object — no other text.

Required JSON fields:
{
  "face_visible": true/false,
  "person_count": number,
  "subject_age_estimate": "infant|toddler|child|teenager|adult|elderly",
  "subject_sex_estimate": "male|female|unknown",
  "location_type": "outdoor_rural|outdoor_urban|indoor_home|indoor_medical|unknown",
  "medical_context": true/false,
  "face_descriptor": "a 10-word physical description of the primary face for duplicate detection",
  "quality_score": 1-10,
  "flags": [],
  "notes": "brief observation"
}`;

  const stageHints = {
    BEFORE: '\n\nContext: This should show a child needing surgery at their home or community.',
    DURING: '\n\nContext: This should show a child at a medical facility with medical staff present.',
    AFTERCARE: '\n\nContext: This should show a child at a recovery facility post-surgery.',
    HOME: '\n\nContext: This should show a child at home, recovered, with family present.'
  };

  return base + (stageHints[stage] || '');
}

// ── Parse the OpenAI JSON response ───────────────────
function parseVisionResponse(raw) {
  try {
    // Strip markdown code blocks if present
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    console.warn('   Could not parse AI response, using defaults');
    return {
      face_visible:        false,
      person_count:        0,
      subject_age_estimate:'unknown',
      subject_sex_estimate:'unknown',
      location_type:       'unknown',
      medical_context:     false,
      face_descriptor:     null,
      quality_score:       1,
      flags:               ['parse_error'],
      notes:               'AI analysis could not be parsed'
    };
  }
}

// ── Check if the video passes basic quality gates ────
// Returns { passed: bool, reason: string }
function qualityCheck(aiResult, stage) {
  if (!aiResult.face_visible) {
    return { passed: false, reason: 'No face visible in the video.' };
  }

  if (aiResult.quality_score < 3) {
    return { passed: false, reason: 'Video quality is too low. Please film in better light.' };
  }

  if (stage === 'DURING' && !aiResult.medical_context) {
    return {
      passed: false,
      reason: 'Video does not appear to be filmed at a medical facility. Please film at the hospital.'
    };
  }

  if (stage === 'HOME' && aiResult.location_type === 'indoor_medical') {
    return {
      passed: false,
      reason: 'The HOME video must be filmed at the child\'s home, not at the hospital.'
    };
  }

  return { passed: true, reason: 'OK' };
}

// ── Generate a simple face hash for duplicate detection
// Not a cryptographic hash — a text descriptor OpenAI generates
// that can be compared with future submissions
function generateFaceHash(aiResult) {
  if (!aiResult.face_visible || !aiResult.face_descriptor) return null;
  // Simple hash: combine descriptor text with age and sex estimate
  const raw = `${aiResult.face_descriptor}-${aiResult.subject_age_estimate}-${aiResult.subject_sex_estimate}`;
  return Buffer.from(raw).toString('base64').substring(0, 32);
}

module.exports = { analyseVideo, qualityCheck, generateFaceHash };
