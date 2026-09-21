/**
 * The household's side of x402 on Stellar: the wallet that pays.
 *
 * It lives in the host, the way a buyer's wallet does, and never in the Bridge (hard rule 1).
 * The signing is `@x402/stellar`'s, over `@stellar/stellar-sdk`; nothing here touches a key
 * beyond handing it to the official signer.
 *
 * Testnet only. The Demo household's wallet is a demo wallet: it holds Circle's test USDC,
 * which cannot be exchanged for anything, and the network is fixed to `stellar:testnet`.
 * Without a secret in the environment the rail simply is not offered.
 */
import { x402Client } from "@x402/core/client";
import { createEd25519Signer, STELLAR_TESTNET_CAIP2 } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { Keypair } from "@stellar/stellar-sdk";

export interface HouseholdWallet {
  /** The address that pays, for the mandate to check and for a receipt to name. */
  address: string;
  network: string;
  /** The ceiling this wallet will sign for, in USD, as the Demo household's mandate sets it. */
  maxPerPaymentUsd: number;
  /** Signs an authorisation for what the Store asked to be paid. */
  pay(requirements: unknown[]): Promise<unknown>;
}

/**
 * The Demo household's wallet, or nothing when no testnet secret is configured. The mandate
 * of ADR-0002 is the client's own spend control: a ceiling per payment, and only the asset
 * this catalogue quotes. A request for anything else is refused before it is ever signed.
 */
export function householdWallet(secret: string | undefined, maxPerPaymentUsd = 50): HouseholdWallet | undefined {
  if (!secret) return undefined;
  const address = Keypair.fromSecret(secret).publicKey();
  const client = new x402Client()
    .register("stellar:*", new ExactStellarScheme(createEd25519Signer(secret, STELLAR_TESTNET_CAIP2)))
    .setSpendControls({ maxAmountPerPayment: `$${maxPerPaymentUsd}` as never, allowedAssets: true });

  return {
    address,
    network: STELLAR_TESTNET_CAIP2,
    maxPerPaymentUsd,
    async pay(requirements) {
      // The client picks the requirement it can satisfy and signs the authorisation entry;
      // the Store's facilitator rebuilds the transaction and submits it.
      return await client.createPaymentPayload({ x402Version: 2, accepts: requirements } as never);
    },
  };
}
