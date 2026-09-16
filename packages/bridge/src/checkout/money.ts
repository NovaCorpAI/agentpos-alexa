/**
 * The Store settles in USDC (7 decimals). A UCP session carries an ISO 4217 currency and
 * integer minor units, so the session is denominated in USD cents, one to one with USDC.
 * The conversion is exact or it is refused: a price with more than two decimals cannot be
 * represented in cents and the item is reported as unavailable, never rounded.
 */
import { BridgeError } from "../errors.js";

export const SESSION_CURRENCY = "USD";
const USDC_DECIMALS = 7n;
const CENTS_DECIMALS = 2n;
const FACTOR = 10n ** (USDC_DECIMALS - CENTS_DECIMALS);

export function usdcMinorToCents(minor: string): number {
  if (!/^[0-9]+$/.test(minor)) {
    throw new BridgeError(502, { code: "STORE_BAD_RESPONSE", message: `Not an integer minor amount: ${minor}`, hint: "The Store must publish integer minor units." });
  }
  const value = BigInt(minor);
  if (value % FACTOR !== 0n) {
    throw new BridgeError(422, {
      code: "PRICE_NOT_REPRESENTABLE",
      message: `${minor} USDC minor units is not a whole number of cents`,
      hint: "Prices in a checkout session are USD cents; the Store must price this item with at most two decimals.",
    });
  }
  const cents = value / FACTOR;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new BridgeError(422, { code: "PRICE_NOT_REPRESENTABLE", message: "Amount too large", hint: "" });
  }
  return Number(cents);
}

export function centsToUsdcMinor(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) throw new RangeError("cents must be a non-negative integer");
  return (BigInt(cents) * FACTOR).toString();
}
