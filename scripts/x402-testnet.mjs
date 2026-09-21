#!/usr/bin/env node
/**
 * Pays one cart with x402 on the Stellar testnet, end to end, and prints the transaction the
 * network recorded:
 *
 *   node scripts/x402-testnet.mjs [amount in USDC minor units]     default: 5500000, one focaccia
 *
 * The three roles are the ones the protocol names, played by the parts that should play them:
 * the fixture Store asks to be paid and settles as its own facilitator, and the household's
 * wallet, which lives in the host, signs. The Bridge is not in this path at all: it never
 * holds a key.
 *
 * Testnet only. Run `node scripts/stellar-testnet.mjs` first to create the accounts, and fund
 * the household at https://faucet.circle.com (Stellar, 20 test USDC every two hours).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const envFile = resolve(root, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { stellarRail } = await import("../packages/fixture-store/src/x402.ts");
const { householdWallet } = await import("../apps/simulator/src/server/x402.ts");

const amountMinor = process.argv[2] ?? "5500000";
const log = (msg, extra = {}) => console.log(JSON.stringify({ msg, ...extra }));

const rail = stellarRail(process.env.FIXTURE_STELLAR_SECRET);
const wallet = householdWallet(process.env.DEMO_HOUSEHOLD_STELLAR_SECRET);
if (!rail) throw new Error("FIXTURE_STELLAR_SECRET is not set: run scripts/stellar-testnet.mjs");
if (!wallet) throw new Error("DEMO_HOUSEHOLD_STELLAR_SECRET is not set: run scripts/stellar-testnet.mjs");
log("accounts", { payTo: rail.payTo, household: wallet.address, network: rail.network, asset: rail.asset });

const requirements = await rail.requirements(amountMinor, "https://store.example/agentpos/checkout?cart=demo", "Sourdough & Co. Bakery: one cart");
log("payment required", { amount: requirements[0]?.amount, asset: requirements[0]?.asset, payTo: requirements[0]?.payTo });

let payload;
try {
  payload = await wallet.pay(requirements);
} catch (e) {
  const message = String(e?.message ?? e);
  // The one failure worth naming: a wallet with nothing in it.
  if (/resulting balance is not within the allowed range|insufficient/i.test(message)) {
    log("the household wallet holds no test USDC", { fund: "https://faucet.circle.com", address: wallet.address });
    process.exit(1);
  }
  throw e;
}
log("signed by the household", { scheme: payload?.scheme, network: payload?.network });

const verified = await rail.verify(payload, requirements[0]);
log("store verified", verified);
if (!verified.isValid) process.exit(1);

const settled = await rail.settle(payload, requirements[0]);
log("store settled", settled);
if (!settled.success) process.exit(1);

console.log(`\nSettled on the Stellar testnet: https://stellar.expert/explorer/testnet/tx/${settled.transaction}\n`);
