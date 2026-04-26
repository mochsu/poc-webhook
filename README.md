# Proof of Care Webhook — Build & Deploy Guide
## Deploy today in ~45 minutes

---

## What you are building

```
WhatsApp (Let's phone)
       ↓
  Meta Business API
       ↓
  This webhook server  ←── PostgreSQL (worker + child records)
       ↓                ←── OpenAI Vision (video quality checks)
  YouTube upload        ←── Gelato (optional, gas management)
       ↓
  Base blockchain (smart contracts)
       ↓
  Reply to Let's WhatsApp
```

---

## Part 1 — PostgreSQL on Railway (5 minutes)

Railway provides a hosted PostgreSQL database for free.

1. Go to **railway.app** → log in with GitHub
2. Click **New Project → Provision PostgreSQL**
3. Click your database → **Variables**
4. Copy the value of `DATABASE_URL` — it looks like:
   `postgresql://postgres:xxxxx@xxx.railway.app:5432/railway`
5. Save this — you will paste it into your `.env`

---

## Part 2 — Meta WhatsApp Business API (20 minutes)

### Create the app
1. Go to **developers.facebook.com** → log in
2. **My Apps → Create App → Business type**
3. Name it "POC Webhook" → Create

### Get your credentials
4. Dashboard → **Add Product → WhatsApp → Set Up**
5. Note down:
   - **Phone Number ID** (from "Step 1: Select a phone number")
   - **Temporary access token** (shown on the same page)

### Get a permanent token
6. Go to **business.facebook.com** → Settings → System Users
7. Create a system user → **Add Assets** → your WhatsApp app → **Generate Token**
8. Select permissions: `whatsapp_business_messaging`, `whatsapp_business_management`
9. Copy the token — this goes in `.env` as `WHATSAPP_TOKEN`

### Add a real phone number (for production)
10. In the WhatsApp section → **Phone Numbers → Add phone number**
11. Use the number your workers will message

---

## Part 3 — OpenAI API key (2 minutes)

1. Go to **platform.openai.com** → API Keys
2. Create new key → copy it
3. Add $10 credit to your account (covers thousands of video analyses)
4. Paste into `.env` as `OPENAI_API_KEY`

---

## Part 4 — Google / YouTube (10 minutes)

1. Go to **console.cloud.google.com**
2. New project → enable **YouTube Data API v3**
3. **IAM → Service Accounts → Create** → download JSON key
4. Paste the entire JSON as one line into `.env` as `GOOGLE_SERVICE_ACCOUNT_JSON`
5. In YouTube Studio → link the service account email as a channel manager

---

## Part 5 — Deploy to Railway (5 minutes)

### Push code to GitHub
1. Create a new repo at github.com
2. Upload all these files
3. Make sure `.env` is in `.gitignore` (never commit secrets)

### Deploy
4. Railway → New Project → Deploy from GitHub → select your repo
5. Railway auto-detects Node.js and deploys
6. Go to **Variables** → add every value from `.env.example`
7. Your URL: `https://poc-webhook-production.up.railway.app`

### Run the database migration
8. In Railway → your project → click the terminal icon
9. Run: `node src/db/migrate.js`
10. You should see all 4 tables created ✓

---

## Part 6 — Connect Meta to your webhook (3 minutes)

1. Meta Developer portal → your app → WhatsApp → Configuration
2. **Webhooks → Edit**
3. Callback URL: `https://your-railway-url.up.railway.app/webhook`
4. Verify Token: same as `WHATSAPP_VERIFY_TOKEN` in your `.env`
5. Click **Verify and Save** → should show ✓
6. Subscribe to the **messages** field

---

## Part 7 — Add your first worker

Run this in the Railway terminal:

```sql
INSERT INTO workers (phone, worker_code, name, role, country, trust_level, wallet)
VALUES ('+255711234567', '145LET', 'Let Mwangi', 'OUTREACH', 'TZ', 'HIGH', '0x...');
```

Or use the seed script:

```bash
node src/db/seed.js
```

---

## Part 8 — Test it

Send a video to your POC WhatsApp number. You should receive a reply within 90 seconds.

**Full test sequence:**
```
1. Send video (no caption)
   → Receive: "✅ Child registered! Child ID: TZ-11001"

2. Send text: "STATUS TZ-11001"
   → Receive: chain status

3. Send video, caption "TZ-11001 DURING"
   → Receive: "✅ Surgery proof accepted"

4. Send video, caption "TZ-11001 HOME"
   → Receive: "🎉 Home video accepted!"
```

---

## File structure

```
poc-webhook/
├── server.js                  ← Express server + webhook endpoints
├── src/
│   ├── processor.js           ← Message router + all business logic
│   ├── whatsapp.js            ← Meta API — send/receive/download
│   ├── youtube.js             ← YouTube auto-upload
│   ├── vision.js              ← OpenAI GPT-4 Vision analysis
│   ├── contract.js            ← Base blockchain smart contract calls
│   ├── gelato.js              ← Gelato relay (gasless transactions)
│   └── db/
│       ├── index.js           ← PostgreSQL connection pool
│       ├── migrate.js         ← Creates all database tables
│       ├── seed.js            ← Add test workers
│       └── operations.js      ← All database read/write functions
├── package.json
├── railway.json               ← Railway deployment config
└── .env.example               ← Copy to .env and fill in values
```

---

## Costs (monthly at MVP scale, ~100 cases/month)

| Service           | Cost                                   |
|-------------------|----------------------------------------|
| Railway (server)  | Free tier (500 hrs/month)              |
| Railway (Postgres)| Free tier (1GB — plenty for MVP)       |
| Meta WhatsApp     | Free (first 1,000 conversations/month) |
| OpenAI Vision     | ~$0.001 per frame = ~$0.10/month       |
| YouTube           | Free                                   |
| Base blockchain   | ~$0.001/tx × 400 txs = ~$0.40/month   |
| Gelato (optional) | Free tier available                    |
| **Total**         | **~$1/month at MVP scale**             |

---

## Gelato — when to turn it on

Leave `USE_GELATO=false` for the MVP. Your admin wallet needs ~$5 of ETH on Base
for gas — this covers thousands of transactions.

Turn on Gelato (`USE_GELATO=true`) when:
- You want zero manual wallet management
- You are processing 500+ cases/month
- You want to remove the ETH top-up step entirely

---

## What Gelato does NOT do

Gelato relays the transaction — it does NOT hold your funds. Your USDC escrow
is always in your smart contract. Gelato only removes the need to hold ETH for gas.
