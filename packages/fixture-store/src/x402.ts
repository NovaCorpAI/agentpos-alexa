/**
 * The Store's side of x402 on Stellar, with the official packages doing every piece of
 * cryptography and every call to the network (hard rule 7): `@x402/core` for the protocol,
 * `@x402/stellar` for the Exact scheme over a Soroban token, `@stellar/stellar-sdk` beneath
 * them both. Nothing here reimplements verify or settle.
 *
 * The Store plays two of the protocol's three roles. As the resource server it answers 402
 * with what it wants to be paid; as its own facilitator it verifies the customer's signed
 * authorisation and submits the transfer, sponsoring the fee from its own account. The
 * customer's wallet is the third role and lives in the host, never here (hard rule 1).
 *
 * Testnet only: the network is fixed to `stellar:testnet`, whose asset is Circle's test USDC,
 * the same asset this catalogue quotes. A settled payment carries a real transaction hash,
 * which is what makes the order real (hard rule 3).
 */
import { x402Facilitator } from "@x402/core/facilitator";
import { x402ResourceServer } from "@x402/core/server";
import { createEd25519Signer, STELLAR_TESTNET_CAIP2, USDC_TESTNET_ADDRESS } from "@x402/stellar";
import { ExactStellarScheme as FacilitatorScheme } from "@x402/stellar/exact/facilitator";
import { ExactStellarScheme as ServerScheme } from "@x402/stellar/exact/server";
import { Keypair } from "@stellar/stellar-sdk";

/** What the Store needs to be paid on chain, and to pay the fee of the transfer it receives. */
export interface StellarRail {
  /** `stellar:testnet`, and nothing else without a deliberate change here. */
  network: string;
  /** The Soroban token that settles: Circle's test USDC. */
  asset: string;
  /** The account the money lands in. */
  payTo: string;
  /** Builds the 402 body for an amount in USDC minor units (7 decimals). */
  requirements(amountMinor: string, resource: string, description: string): Promise<unknown[]>;
  /** Verifies the customer's payload against those requirements. */
  verify(payload: unknown, requirements: unknown): Promise<{ isValid: boolean; invalidReason?: string }>;
  /** Submits the transfer and returns the transaction as the network recorded it. */
  settle(payload: unknown, requirements: unknown): Promise<{ success: boolean; transaction?: string; errorReason?: string }>;
}

/** Minor units to the decimal string the protocol's price field takes. USDC has 7 decimals. */
export function minorToDecimal(minor: string, decimals = 7): string {
  const digits = minor.replace(/^0+(?=\d)/, "").padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * The rail, or nothing when the Store has no testnet key configured: without one it cannot
 * sponsor a transfer, and a Store that cannot settle must not advertise that it can.
 */
export function stellarRail(secret: string | undefined): StellarRail | undefined {
  if (!secret) return undefined;
  const keypair = Keypair.fromSecret(secret);
  const payTo = keypair.publicKey();
  const signer = createEd25519Signer(secret, STELLAR_TESTNET_CAIP2);
  const facilitator = new x402Facilitator().register(STELLAR_TESTNET_CAIP2, new FacilitatorScheme([signer]));
  // The facilitator runs in this process: a Store this small does not operate a second service.
  const resource = new x402ResourceServer(facilitator as never).register(STELLAR_TESTNET_CAIP2, new ServerScheme());

  // The resource server asks its facilitator which kinds it supports before it will quote a
  // price. Done once, on the first payment, so a Store that is never paid never asks.
  let ready: Promise<unknown> | undefined;
  const initialized = () => (ready ??= resource.initialize());

  return {
    network: STELLAR_TESTNET_CAIP2,
    asset: USDC_TESTNET_ADDRESS,
    payTo,
    async requirements(amountMinor, resource_, description) {
      await initialized();
      return (await resource.buildPaymentRequirements({
        scheme: "exact",
        network: STELLAR_TESTNET_CAIP2,
        payTo,
        // The price travels in the asset's own atomic units, which is what this catalogue
        // quotes already: USDC with seven decimals, integers, never a float.
        price: { asset: USDC_TESTNET_ADDRESS, amount: amountMinor },
        maxTimeoutSeconds: 300,
        extra: { resource: resource_, description },
      } as never)) as unknown[];
    },
    async verify(payload, requirements) {
      await initialized();
      const r = (await resource.verifyPayment(payload as never, requirements as never)) as { isValid: boolean; invalidReason?: string };
      return { isValid: r.isValid === true, ...(r.invalidReason ? { invalidReason: r.invalidReason } : {}) };
    },
    async settle(payload, requirements) {
      await initialized();
      const r = (await resource.settlePayment(payload as never, requirements as never)) as { success: boolean; transaction?: string; errorReason?: string };
      return { success: r.success === true, ...(r.transaction ? { transaction: r.transaction } : {}), ...(r.errorReason ? { errorReason: r.errorReason } : {}) };
    },
  };
}
