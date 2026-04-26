// ─────────────────────────────────────────────────────
// src/youtube.js — YouTube Auto-Upload
//
// Uploads proof videos to the POC YouTube channel.
// Videos are set to "unlisted" — accessible via link
// but not searchable. The video ID becomes part of
// the proof chain hash.
// ─────────────────────────────────────────────────────

const { google } = require('googleapis');
const { Readable } = require('stream');
const { getAuth } = require('./sheets');

// ── Upload a video buffer to YouTube ─────────────────
// Returns the YouTube video ID (e.g. "mhzNY2QZsh0")
async function uploadVideo({ videoBuffer, title, description, tags = [] }) {
  console.log(`   Uploading to YouTube: "${title}"...`);

  const auth    = getAuth();
  const youtube = google.youtube({ version: 'v3', auth });

  // Convert buffer to readable stream
  const stream = Readable.from(videoBuffer);

  try {
    const response = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title,
          description,
          tags: ['ProofOfCare', 'POC', ...tags],
          categoryId: '22', // People & Blogs
          defaultLanguage: 'en'
        },
        status: {
          privacyStatus: 'unlisted',  // visible via link, not searchable
          selfDeclaredMadeForKids: false
        }
      },
      media: {
        mimeType: 'video/mp4',
        body: stream
      }
    });

    const videoId  = response.data.id;
    const videoUrl = `https://youtube.com/watch?v=${videoId}`;
    console.log(`   ✓ YouTube upload complete: ${videoUrl}`);
    return videoId;

  } catch (err) {
    console.error('YouTube upload failed:', err.message);
    throw err;
  }
}

// ── Build a standardised video title ─────────────────
// Format matches the existing POC YouTube naming convention
// e.g. "AMINA HASSAN (11156) - BEFORE VIDEO"
function buildVideoTitle(childId, stage, childName = '') {
  const stageLabel = {
    BEFORE:     'BEFORE VIDEO',
    DURING:     'DURING VIDEO',
    AFTERCARE:  'AFTERCARE VIDEO',
    HOME:       'HOME VIDEO',
    REVIEW:     'REVIEW VIDEO',
    PROSTHETIC: 'PROSTHETIC VIDEO'
  }[stage] || `${stage} VIDEO`;

  if (childName) {
    return `${childName.toUpperCase()} (${childId}) - ${stageLabel}`;
  }
  return `POC (${childId}) - ${stageLabel}`;
}

module.exports = { uploadVideo, buildVideoTitle };
