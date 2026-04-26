const { google } = require('googleapis');
const { Readable } = require('stream');

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}');
  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/youtube',
      'https://www.googleapis.com/auth/spreadsheets'
    ]
  });
}

async function uploadVideo({ videoBuffer, title, description, tags = [] }) {
  console.log(`   Uploading to YouTube: "${title}"...`);
  const auth    = getAuth();
  const youtube = google.youtube({ version: 'v3', auth });
  const stream  = Readable.from(videoBuffer);
  try {
    const response = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: { title, description, tags: ['ProofOfCare', 'POC', ...tags], categoryId: '22' },
        status:  { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false }
      },
      media: { mimeType: 'video/mp4', body: stream }
    });
    const videoId = response.data.id;
    console.log(`   ✓ YouTube upload: https://youtube.com/watch?v=${videoId}`);
    return videoId;
  } catch (err) {
    console.error('YouTube upload failed:', err.message);
    throw err;
  }
}

function buildVideoTitle(childId, stage, childName = '') {
  const labels = { BEFORE:'BEFORE VIDEO', DURING:'DURING VIDEO', AFTERCARE:'AFTERCARE VIDEO', HOME:'HOME VIDEO' };
  const label  = labels[stage] || `${stage} VIDEO`;
  return childName ? `${childName.toUpperCase()} (${childId}) - ${label}` : `POC (${childId}) - ${label}`;
}

module.exports = { uploadVideo, buildVideoTitle, getAuth };
