#!/usr/bin/env node
/**
 * Prepares the two Stellar testnet accounts the x402 rail needs, and nothing else:
 *
 *   node scripts/stellar-testnet.mjs
 *
 *   - the demo household's wallet, which pays;
 *   - the fixture Store's account, which is paid and sponsors the transaction fee.
 *
 * Both are created with Friendbot and given a USDC trustline for Circle's testnet issuer, so
 * the asset that settles is the same asset the catalogue quotes. Running it again does
 * nothing but report: the keys are read back from .env.
 *
 * Testnet only, by construction: the network passphrase is hard coded and Friendbot exists
 * nowhere else. These are demo keys for a demo household and a fixture store, written to
 * .env, which is git ignored; no merchant's and no real household's key is ever stored here
 * (hard rule 1). The public keys are printed, the secrets never are.
 *
 * The one step a person has to take: paste the household's address into Circle's faucet at
 * https://faucet.circle.com (pick Stellar), which sends 20 test USDC every two hours.
 */
import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const envFile = resolve(root, ".env");
const HORIZON = "https://horizon-testnet.stellar.org";
const FRIENDBOT = "https://friendbot.stellar.org";
/** Circle's USDC issuer on the Stellar testnet. */
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const USDC = new Asset("USDC", USDC_ISSUER);

const log = (msg, extra = {}) => console.log(JSON.stringify({ msg, ...extra }));

function envValue(key) {
  if (process.env[key]) return process.env[key];
  if (!existsSync(envFile)) return undefined;
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = new RegExp(`^${key}=(.*)$`).exec(line.trim());
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  return undefined;
}

/** Writes a key to .env once. The value is never logged. */
function remember(key, value) {
  const existing = envValue(key);
  if (existing) return existing;
  appendFileSync(envFile, `${existsSync(envFile) && readFileSync(envFile, "utf8").endsWith("\n") ? "" : "\n"}${key}=${value}\n`);
  log("written to .env", { key });
  return value;
}

const server = new Horizon.Server(HORIZON);

/** An account that exists on the testnet, created with Friendbot if it does not. */
async function ensureAccount(label, envKey) {
  const secret = remember(envKey, Keypair.random().secret());
  const keypair = Keypair.fromSecret(secret);
  const address = keypair.publicKey();
  try {
    await server.loadAccount(address);
    log("account exists", { label, address });
  } catch {
    const res = await fetch(`${FRIENDBOT}?addr=${address}`);
    if (!res.ok) throw new Error(`friendbot refused ${label}: ${res.status}`);
    log("account funded by friendbot", { label, address });
  }
  return keypair;
}

/** The trustline a classic asset needs before an account can hold it. */
async function ensureTrustline(keypair, label) {
  const account = await server.loadAccount(keypair.publicKey());
  const has = account.balances.some((b) => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER);
  if (has) {
    const balance = account.balances.find((b) => b.asset_code === "USDC")?.balance ?? "0";
    log("trustline exists", { label, usdc: balance });
    return balance;
  }
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(60)
    .build();
  tx.sign(keypair);
  const sent = await server.submitTransaction(tx);
  log("trustline added", { label, hash: sent.hash });
  return "0";
}

const household = await ensureAccount("demo household wallet", "DEMO_HOUSEHOLD_STELLAR_SECRET");
const store = await ensureAccount("fixture store account", "FIXTURE_STELLAR_SECRET");
const householdUsdc = await ensureTrustline(household, "demo household wallet");
await ensureTrustline(store, "fixture store account");

remember("FIXTURE_STELLAR_PAY_TO", store.publicKey());

console.log(
  [
    "",
    "Household wallet (this is the address to fund):",
    `  ${household.publicKey()}`,
    `  USDC balance now: ${householdUsdc}`,
    "",
    "Store account, where the payment lands:",
    `  ${store.publicKey()}`,
    "",
    householdUsdc === "0" || Number(householdUsdc) < 1
      ? "Next: open https://faucet.circle.com, choose Stellar, paste the household address and send test USDC (20 per two hours)."
      : "The household can pay: the rail is ready to settle on the testnet.",
    "",
  ].join("\n"),
);
