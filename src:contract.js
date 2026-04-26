// ─────────────────────────────────────────────────────
// src/contract.js — Smart Contract Calls
// Supports direct calls and Gelato relay
// ─────────────────────────────────────────────────────

const { ethers }  = require('ethers');
const gelato      = require('./gelato');

const OUTCOME_ABI = [
  'function registerChild(string,string,string,string,string,tuple(uint16,uint16,uint16,uint16),address,address,address,address,address) returns (bytes32)',
  'function submitOutreachProof(bytes32,string,string)',
  'function submitSurgeryProof(bytes32,string,string,string,string)',
  'function submitAftercareProof(bytes32,string,string,uint16,string)',
  'function submitHomeProof(bytes32,string)',
  'function verifyOutcome(bytes32,uint8,string)',
  'function getChainSummary(bytes32) view returns (string,uint8,bytes32,string,string,string,string,uint8,uint256,bool)',
  'event ChildRegistered(bytes32 indexed outcomeId, string childId, bytes32 initialHash)'
];

const BASE_CHAIN_ID = 8453;         // mainnet
const BASE_SEPOLIA_CHAIN_ID = 84532; // testnet

let _provider, _wallet, _contract;

function getContracts() {
  if (!_provider) {
    _provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
    _wallet   = new ethers.Wallet(process.env.POC_ADMIN_PRIVATE_KEY, _provider);
    _contract = new ethers.Contract(
      process.env.CONTRACT_OUTCOME_ADDRESS,
      OUTCOME_ABI,
      _wallet
    );
  }
  return { provider: _provider, wallet: _wallet, contract: _contract };
}

// ── Call a contract function (direct or via Gelato) ──
async function callContract(functionName, args) {
  const { contract, wallet } = getContracts();
  const useGelato = process.env.USE_GELATO === 'true';

  if (useGelato && process.env.GELATO_API_KEY) {
    const data    = gelato.encodeCall(contract, functionName, args);
    const chainId = process.env.BASE_RPC_URL.includes('sepolia')
      ? BASE_SEPOLIA_CHAIN_ID
      : BASE_CHAIN_ID;
    return await gelato.sponsoredCall({
      chainId,
      target: process.env.CONTRACT_OUTCOME_ADDRESS,
      data
    });
  } else {
    // Direct call — POC admin wallet pays gas (~$0.001 on Base)
    const tx      = await contract[functionName](...args);
    const receipt = await tx.wait();
    return receipt.hash;
  }
}

// ── Register a new child on-chain ────────────────────
async function registerChild({ childId, country, diagnosisCode, demographics, workerWallet }) {
  const { wallet } = getContracts();
  console.log('   Calling registerChild() on Base...');

  const allocation = [1500, 5000, 1500, 2000]; // 15/50/15/20%
  const admin      = wallet.address;
  const actor      = workerWallet || admin;

  const txHash = await callContract('registerChild', [
    childId, country, diagnosisCode || 'TBC',
    demographics || 'TBC', '000',
    allocation,
    actor, admin, admin, admin, admin
  ]);

  // Get the outcomeId from events
  const { contract, provider } = getContracts();
  const receipt = await provider.getTransactionReceipt(txHash);
  const event   = receipt?.logs
    .map(log => { try { return contract.interface.parseLog(log); } catch { return null; } })
    .find(e => e?.name === 'ChildRegistered');

  const outcomeId  = event?.args?.outcomeId || null;
  const chainHash  = event?.args?.initialHash || null;
  console.log(`   ✓ Registered on-chain. OutcomeId: ${outcomeId}`);
  return { outcomeId, chainHash, txHash };
}

async function submitOutreachProof({ outcomeId, workerCode, youtubeVideoId }) {
  console.log('   Calling submitOutreachProof()...');
  const txHash = await callContract('submitOutreachProof', [outcomeId, workerCode, youtubeVideoId]);
  console.log('   ✓ Outreach proof on-chain');
  return txHash;
}

async function submitSurgeryProof({ outcomeId, hospitalCode, surgeonCode, procedureCode, youtubeVideoId }) {
  console.log('   Calling submitSurgeryProof()...');
  const txHash = await callContract('submitSurgeryProof',
    [outcomeId, hospitalCode, surgeonCode, procedureCode, youtubeVideoId]);
  console.log('   ✓ Surgery proof on-chain');
  return txHash;
}

async function submitAftercareProof({ outcomeId, locationCode, nurseCode, aftercareDays, youtubeVideoId }) {
  console.log('   Calling submitAftercareProof()...');
  const txHash = await callContract('submitAftercareProof',
    [outcomeId, locationCode, nurseCode, aftercareDays || 14, youtubeVideoId]);
  console.log('   ✓ Aftercare proof on-chain');
  return txHash;
}

async function submitHomeProof({ outcomeId, youtubeVideoId }) {
  console.log('   Calling submitHomeProof()...');
  const txHash = await callContract('submitHomeProof', [outcomeId, youtubeVideoId]);
  console.log('   ✓ Home proof on-chain');
  return txHash;
}

async function getChainSummary(outcomeId) {
  const { contract } = getContracts();
  const s = await contract.getChainSummary(outcomeId);
  return {
    childId: s[0], stage: s[1], chainHash: s[2],
    outreachVideo: s[3], surgeryVideo: s[4],
    aftercareVideo: s[5], homeVideo: s[6],
    starRating: s[7], usdcAmount: s[8], paid: s[9]
  };
}

module.exports = {
  registerChild,
  submitOutreachProof,
  submitSurgeryProof,
  submitAftercareProof,
  submitHomeProof,
  getChainSummary
};
