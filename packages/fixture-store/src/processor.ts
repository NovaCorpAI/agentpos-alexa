/**
 * The merchant's own PSP, executed Store-side (#9). The Store is merchant of record: it holds
 * its processor's secret key and runs the charge; the Bridge only forwards the token the
 * platform got from the processor. This is the shape proposed for the AgentPOS core's
 * PaymentRail (upstream PR); the fixture implements it with Stripe in test mode only.
 */
import Stripe from "stripe";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export interface ChargeInput {
  amountCents: number;
  currency: "usd";
  /** A processor token or payment method id from the platform, e.g. pm_card_visa in test mode. */
  token: string;
  /** One charge per cart and card, whatever the retries. */
  idempotencyKey: string;
  description: string;
  metadata: Record<string, string>;
}

export type ChargeResult =
  | { status: "succeeded"; reference: string; livemode: boolean }
  | { status: "declined"; code: string; message: string }
  | { status: "requires_action"; reference: string };

export interface MerchantProcessor {
  psp: "stripe";
  environment: "sandbox";
  publishableKey: string;
  charge(input: ChargeInput): Promise<ChargeResult>;
}

/** Stripe in test mode. A live secret key is refused: the fixture never moves real money. */
export function stripeTestProcessor(secretKey: string, publishableKey: string): MerchantProcessor {
  if (!secretKey.startsWith("sk_test_") && !secretKey.startsWith("rk_test_")) {
    throw new Error("The fixture Store accepts only a Stripe test-mode secret key (sk_test_ or rk_test_).");
  }
  if (!publishableKey.startsWith("pk_test_")) {
    throw new Error("The fixture Store accepts only a Stripe test-mode publishable key (pk_test_).");
  }
  const stripe = new Stripe(secretKey, { appInfo: { name: "agentpos-alexa-fixture-store", url: "https://github.com/NovaCorpAI/agentpos-alexa" } });
  return {
    psp: "stripe",
    environment: "sandbox",
    publishableKey,
    async charge(input) {
      try {
        const pi = await stripe.paymentIntents.create(
          {
            amount: input.amountCents,
            currency: input.currency,
            payment_method: input.token,
            confirm: true,
            automatic_payment_methods: { enabled: true, allow_redirects: "never" },
            description: input.description,
            metadata: input.metadata,
          },
          { idempotencyKey: input.idempotencyKey },
        );
        if (pi.status === "succeeded") return { status: "succeeded", reference: pi.id, livemode: pi.livemode };
        if (pi.status === "requires_action") return { status: "requires_action", reference: pi.id };
        return { status: "declined", code: pi.status, message: `The payment is ${pi.status.replace(/_/g, " ")}.` };
      } catch (e) {
        if (e instanceof Stripe.errors.StripeCardError) {
          return { status: "declined", code: e.decline_code ?? e.code ?? "card_declined", message: e.message };
        }
        // A reused idempotency key with different parameters: the buyer must start a new checkout.
        if (isRecord(e) && e.type === "StripeIdempotencyError") {
          return { status: "declined", code: "idempotency_conflict", message: "That payment was already attempted with different details. Start the checkout again." };
        }
        throw e;
      }
    },
  };
}
