import { describe, expect, it } from "vitest";
import { createFixtureStore, PROCESSOR_HANDLER } from "./app.js";
import { stripeTestProcessor, type ChargeInput, type MerchantProcessor } from "./processor.js";

const BASE = "http://bakery.test";
const buyer = { email: "alex.demo@example.com", name: "Alex Demo" };
const shipping = { name: "Alex Demo", line1: "1 Fixture Street", city: "Santiago", postalCode: "8320000", country: "CL" };

/** Stands in for Stripe: pm_card_visa succeeds, pm_card_chargeDeclined declines, one charge per idempotency key. */
export function fakeStripe(): MerchantProcessor & { charges: ChargeInput[] } {
  const charges: ChargeInput[] = [];
  const byKey = new Map<string, string>();
  return {
    psp: "stripe",
    environment: "sandbox",
    publishableKey: "pk_test_fixture",
    charges,
    async charge(input) {
      charges.push(input);
      if (input.token === "pm_card_chargeDeclined") return { status: "declined", code: "generic_decline", message: "Your card was declined." };
      const ref = byKey.get(input.idempotencyKey) ?? `pi_test_${byKey.size + 1}`;
      byKey.set(input.idempotencyKey, ref);
      return { status: "succeeded", reference: ref, livemode: false };
    },
  };
}

const post = (app: { request: (p: string, i: RequestInit) => Response | Promise<Response> }, path: string, body: unknown) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("merchant PSP checkout on the fixture Store", () => {
  it("advertises the processor tokenizer only when the Store has a processor, with the public key and never a secret", async () => {
    const without = await (await createFixtureStore({ baseUrl: BASE }).app.request("/.well-known/ucp")).json();
    expect(Object.keys(without.ucp.payment_handlers)).toEqual(["org.x402.stellar"]);
    const withPsp = await (await createFixtureStore({ baseUrl: BASE, processor: fakeStripe() }).app.request("/.well-known/ucp")).json();
    expect(withPsp.ucp.payment_handlers[PROCESSOR_HANDLER][0]).toMatchObject({ id: "processor-tokenizer", config: { environment: "sandbox", psp: "stripe", publishable_key: "pk_test_fixture", currency: "usd", checkout: `${BASE}/agentpos/checkout/processor` } });
    expect(JSON.stringify(withPsp)).not.toMatch(/sk_(test|live)_/);
  });

  it("charges the exact quote in cents once per cart, creates the order only on success, and declines without an order", async () => {
    const stripe = fakeStripe();
    const { app, state } = createFixtureStore({ baseUrl: BASE, processor: stripe });
    const cart = (await (await post(app, "/agentpos/cart", { items: [{ itemId: "sourdough-loaf", quantity: 2 }], buyer, shipping })).json()) as { cartId: string };

    const declined = await post(app, `/agentpos/checkout/processor?cart=${cart.cartId}`, { token: "pm_card_chargeDeclined" });
    expect(declined.status).toBe(402);
    expect(await declined.json()).toEqual({ error: { code: "PAYMENT_DECLINED", message: "Your card was declined.", hint: "generic_decline" } });
    expect(state.orders.size).toBe(0);

    const paid = await post(app, `/agentpos/checkout/processor?cart=${cart.cartId}`, { token: "pm_card_visa" });
    expect(paid.status).toBe(200);
    const { orderId } = (await paid.json()) as { orderId: string };
    expect(stripe.charges.at(-1)).toMatchObject({ amountCents: 1300, currency: "usd", idempotencyKey: `agentpos-cart-${cart.cartId}` });
    const order = await (await app.request(`/agentpos/orders/${orderId}`)).json();
    expect(order.payment).toMatchObject({ protocol: "processor", processor: "stripe", mode: "test", reference: "pi_test_1", amountCents: 1300 });

    const again = await post(app, `/agentpos/checkout/processor?cart=${cart.cartId}`, { token: "pm_card_visa" });
    expect(((await again.json()) as { orderId: string }).orderId).toBe(orderId);
    expect(stripe.charges).toHaveLength(2);
    expect(state.orders.size).toBe(1);

    expect((await post(app, `/agentpos/checkout/processor?cart=${cart.cartId}`, {})).status).toBe(400);
    expect((await post(app, "/agentpos/checkout/processor?cart=nope", { token: "pm_card_visa" })).status).toBe(409);
    expect((await post(createFixtureStore({ baseUrl: BASE }).app, `/agentpos/checkout/processor?cart=${cart.cartId}`, { token: "pm_card_visa" })).status).toBe(404);
  });

  it("refuses live Stripe keys: the fixture never moves real money", () => {
    expect(() => stripeTestProcessor("sk_live_abc", "pk_live_abc")).toThrow(/test-mode secret key/);
    expect(() => stripeTestProcessor("sk_test_abc", "pk_live_abc")).toThrow(/test-mode publishable key/);
    expect(stripeTestProcessor("sk_test_abc", "pk_test_abc")).toMatchObject({ psp: "stripe", environment: "sandbox" });
  });
});
