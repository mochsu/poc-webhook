// src/db/seed.js — Add test workers to the database
// Run: node src/db/seed.js

require('dotenv').config();
const { query } = require('./index');

async function seed() {
  console.log('Seeding workers...\n');

  const workers = [
    {
      phone:       '+255711000001',
      workerCode:  '145LET',
      name:        'Let Mwangi',
      role:        'OUTREACH',
      trust:       'HIGH',
      country:     'TZ',
      wallet:      '' // add Coinbase wallet address when known
    },
    {
      phone:       '+255711000002',
      workerCode:  'SEL-ELI',
      name:        'Dr Eli',
      role:        'HOSPITAL',
      trust:       'HIGH',
      country:     'TZ',
      wallet:      ''
    }
  ];

  for (const w of workers) {
    await query(`
      INSERT INTO workers (phone, worker_code, name, role, trust_level, country, wallet)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (phone) DO NOTHING
    `, [w.phone, w.workerCode, w.name, w.role, w.trust, w.country, w.wallet]);
    console.log(`✓ Added worker: ${w.workerCode} (${w.phone})`);
  }

  console.log('\n✅ Seed complete.\n');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
