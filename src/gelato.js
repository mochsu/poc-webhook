// ─────────────────────────────────────────────────────
// src/gelato.js — Gelato Network Relay (Optional)
//
// Gelato allows the smart contract to be called without
// the POC admin wallet needing ETH for gas.
// Instead, Gelato pays the gas and POC pays Gelato in USDC.
//
// When USE_GELATO=true:
//   Contract calls go via Gelato relay
//   POC admin wallet never needs ETH top-ups
//
// When USE_GELATO=false:
//   Contract calls go directly
//   POC admin wallet needs a small ETH balance for gas
//   (on Base: ~$0.001 per tx, $10 covers thousands of transactions)
//
// For the MVP, USE_GELATO=false is fine. Switch to true
// when you want fully automated gas management.
// ─────────────────────────────────────────────────────

const axios  = require('axios');
const { ethers } = require('ethers');

const GELATO_RELAY_URL = 'https://relay.gelato.digital/relays/v2/sponsored-call';

// ── Send a sponsored call via Gelato ─────────────────
// Gelato pays the gas. You pay Gelato in USDC monthly.
async function sponsoredCall({ chainId, target, data }) {
  if (!process.env.GELATO_API_KEY) {
    throw new Error('GELATO_API_KEY not set');
  }

  console.log('   Sending via Gelato relay...');

  const response = await axios.post(GELATO_RELAY_URL, {
    chainId:  chainId.toString(),
    target,
    data,
    sponsorApiKey: process.env.GELATO_API_KEY
  });

  const taskId = response.data.taskId;
  console.log(`   Gelato task: ${taskId}`);

  // Poll for completion
  const txHash = await waitForGelato(taskId);
  return txHash;
}

// ── Wait for a Gelato task to complete ───────────────
async function waitForGelato(taskId, maxWaitMs = 60000) {
  const start = Date.now();
  const url   = `https://relay.gelato.digital/tasks/status/${taskId}`;

  while (Date.now() - start < maxWaitMs) {
    await sleep(3000);
    try {
      const response = await axios.get(url);
      const task     = response.data.task;

      if (task.taskState === 'ExecSuccess') {
        console.log(`   ✓ Gelato confirmed: ${task.transactionHash}`);
        return task.transactionHash;
      }

      if (task.taskState === 'Cancelled' || task.taskState === 'ExecReverted') {
        throw new Error(`Gelato task failed: ${task.taskState}`);
      }

      console.log(`   Gelato: ${task.taskState}...`);
    } catch (err) {
      if (err.message.includes('Gelato task failed')) throw err;
      // Network error — retry
    }
  }

  throw new Error('Gelato task timed out after 60 seconds');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Encode a contract call for Gelato ────────────────
function encodeCall(contract, functionName, args) {
  return contract.interface.encodeFunctionData(functionName, args);
}

module.exports = { sponsoredCall, encodeCall };
