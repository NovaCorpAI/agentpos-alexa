/**
 * The host's checkout pattern (ADR: checkout is the host's, not a view). The Simulator
 * drives the UCP session exactly as Alexa+ would: create with the lines, update with the
 * Demo household's delivery address, complete with the chosen handler's credential. The
 * Synthetic persona below is fixed and never logged.
 */
import { randomUUID } from "node:crypto";
import type { BridgeCheckoutClient } from "./bridge-client.js";

/** Fixed checkout identity of the Demo household. Fake by construction. */
export const SYNTHETIC_PERSONA = {
  buyer: { first_name: "Alex", last_name: "Demo", email: "alex.demo@example.com" },
  destination: { id: "addr_demo_home", street_address: "1 Fixture Street", address_locality: "Santiago", address_region: "RM", postal_code: "8320000", address_country: "CL" },
} as const;

export interface LineItemInput {
  itemId: string;
  title: string;
  quantity: number;
}

export interface PaymentOption {
  /** handler id as declared in ucp.payment_handlers */
  handlerId: string;
  namespace: string;
  label: string;
  simulated: boolean;
  /** A real processor in its test mode (Stripe test keys): real API, no real money. */
  testMode: boolean;
  /** For stored payment methods: the instrument to reference. */
  instrumentId?: string;
  available: boolean;
  reason?: string;
}

export interface Session {
  id: string;
  status: string;
  currency: string;
  line_items: Array<{ id: string; item: { id: string; title: string; price: number }; quantity: number }>;
  totals: Array<{ type: string; amount: number; display_text?: string }>;
  messages: Array<{ type: string; code?: string; content: string; severity?: string; path?: string }>;
  ucp: { payment_handlers: Record<string, Array<{ id: string; simulated?: boolean; test_mode?: boolean; config?: { environment?: string; psp?: string } }>> };
  payment?: { instruments: Array<{ id: string; handler_id: string; type: string; display?: Record<string, unknown> }> };
  order?: { id: string; permalink_url: string };
  expires_at: string;
}

export interface CheckoutState {
  sessionId: string;
  addon: string;
  session: Session;
  options: PaymentOption[];
  speak: string;
}

const KNOWN: Record<string, { label: string; kind: "network_token" | "stored" | "tokenizer" | "unsupported" }> = {
  "com.agentposhq.processor_tokenizer": { label: "Card through the store's Stripe", kind: "tokenizer" },
  "com.amazon.payments.network_token": { label: "Amazon wallet card", kind: "network_token" },
  "com.amazon.payments.stored_payment_method": { label: "Saved card", kind: "stored" },
  "org.x402.stellar": { label: "USDC wallet (x402)", kind: "unsupported" },
};

export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function options(session: Session): PaymentOption[] {
  const out: PaymentOption[] = [];
  for (const [ns, list] of Object.entries(session.ucp.payment_handlers)) {
    const known = KNOWN[ns];
    for (const h of list) {
      const testMode = h.test_mode === true || h.config?.environment === "sandbox";
      if (!known || known.kind === "unsupported") {
        out.push({ handlerId: h.id, namespace: ns, label: known?.label ?? ns, simulated: h.simulated === true, testMode, available: false, reason: "not wired in the simulator yet" });
      } else if (known.kind === "tokenizer") {
        // The Demo household only has a processor test card; a live processor is not offered.
        out.push({ handlerId: h.id, namespace: ns, label: `${known.label} (test card 4242)`, simulated: false, testMode, available: testMode, ...(testMode ? {} : { reason: "live processors are not available to the demo household" }) });
      } else if (known.kind === "stored") {
        for (const inst of session.payment?.instruments.filter((i) => i.handler_id === h.id) ?? []) {
          const d = inst.display ?? {};
          out.push({ handlerId: h.id, namespace: ns, label: `${known.label}: ${String(d.brand ?? "card")} ending ${String(d.last_digits ?? "")}`, simulated: h.simulated === true, testMode, instrumentId: inst.id, available: true });
        }
      } else {
        out.push({ handlerId: h.id, namespace: ns, label: known.label, simulated: h.simulated === true, testMode, available: true });
      }
    }
  }
  return out;
}

function total(session: Session): number {
  return session.totals.find((t) => t.type === "total")?.amount ?? 0;
}

function speakSession(session: Session, opts: PaymentOption[]): string {
  const lines = session.line_items.map((l) => `${l.quantity} ${l.item.title}`).join(", ");
  if (session.status === "ready_for_complete") {
    const first = opts.find((o) => o.available);
    return `${lines}. Your total is ${dollars(total(session))} delivered to ${SYNTHETIC_PERSONA.destination.street_address}. ${first ? `Shall I pay with your ${first.label}${first.simulated ? ", simulated" : first.testMode ? ", in test mode" : ""}?` : "No payment method is available."}`;
  }
  const err = session.messages.find((m) => m.type === "error");
  return err ? `${lines}. ${err.content}` : `${lines}.`;
}

/**
 * The Demo household's Buyer mandate on the public playground (ADR-0002): simulated or
 * Test mode rails only, and a ceiling per order. Refused before anything reaches the Bridge.
 */
export interface DemoMandate {
  maxTotalCents: number;
}

export interface ConfirmOptions {
  purchaseOrigin?: "own" | "third_party";
  mandate?: DemoMandate;
}

export class CheckoutFlow {
  private readonly states = new Map<string, CheckoutState>();

  constructor(private readonly client: BridgeCheckoutClient) {}

  get(sessionId: string): CheckoutState | undefined {
    return this.states.get(sessionId);
  }

  /** Create, then update with the persona's address so the Store quotes it: one call for the host. */
  async start(addon: string, lines: LineItemInput[], traceId: string): Promise<CheckoutState> {
    const created = await this.client.create(addon, { line_items: lines.map((l) => ({ item: { id: l.itemId }, quantity: l.quantity })), buyer: SYNTHETIC_PERSONA.buyer, context: { language: "en-US", address_country: SYNTHETIC_PERSONA.destination.address_country } }, traceId, randomUUID());
    if (created.status !== 201) throw new Error(`checkout create answered ${created.status}: ${JSON.stringify(created.body).slice(0, 200)}`);
    let session = created.body as unknown as Session;
    const needsAddress = session.messages.some((m) => m.type === "error" && m.path?.startsWith("$.fulfillment"));
    if (needsAddress) {
      const updated = await this.client.update(addon, session.id, {
        line_items: session.line_items.map((l) => ({ id: l.id, item: { id: l.item.id }, quantity: l.quantity })),
        buyer: SYNTHETIC_PERSONA.buyer,
        context: { language: "en-US", address_country: SYNTHETIC_PERSONA.destination.address_country },
        fulfillment: { methods: [{ id: "shipping_1", type: "shipping", selected_destination_id: SYNTHETIC_PERSONA.destination.id, line_item_ids: session.line_items.map((l) => l.id), destinations: [SYNTHETIC_PERSONA.destination] }] },
      }, traceId, randomUUID());
      if (updated.status !== 200) throw new Error(`checkout update answered ${updated.status}`);
      session = updated.body as unknown as Session;
    }
    const opts = options(session);
    const state: CheckoutState = { sessionId: session.id, addon, session, options: opts, speak: speakSession(session, opts) };
    this.states.set(session.id, state);
    return state;
  }

  /** Complete with the chosen option's credential. Simulated credentials are labeled as such. */
  async confirm(sessionId: string, handlerId: string, instrumentId: string | undefined, traceId: string, how: ConfirmOptions = {}): Promise<CheckoutState> {
    const state = this.states.get(sessionId);
    if (!state) throw new Error("unknown checkout session");
    const opt = state.options.find((o) => o.handlerId === handlerId && (instrumentId ? o.instrumentId === instrumentId : true) && o.available);
    if (!opt) throw new Error("that payment option is not available");
    if (how.mandate) {
      const refusal = !opt.simulated && !opt.testMode
        ? "The demo household can only pay with simulated or test mode methods. Bring your own wallet to buy for real."
        : total(state.session) > how.mandate.maxTotalCents
          ? `That is above the demo household's limit of ${dollars(how.mandate.maxTotalCents)} per order. Try fewer items.`
          : undefined;
      if (refusal) {
        const refused: CheckoutState = { ...state, speak: refusal };
        this.states.set(sessionId, refused);
        return refused;
      }
    }
    const kind = KNOWN[opt.namespace]?.kind;
    const instrument =
      kind === "tokenizer"
        ? // Stripe's test payment method for card 4242: accepted only by a test-mode key, never a real card.
          { id: `instr_${randomUUID().slice(0, 8)}`, handler_id: handlerId, type: "card", selected: true, display: { brand: "visa", last_digits: "4242", expiry_month: 12, expiry_year: 2030 }, credential: { type: "token", token: "pm_card_visa" } }
        : kind === "stored"
        ? { id: `instr_${randomUUID().slice(0, 8)}`, handler_id: handlerId, type: "card", credential: { type: "payment_method_reference", payment_method_id: opt.instrumentId } }
        : {
            id: `instr_${randomUUID().slice(0, 8)}`,
            handler_id: handlerId,
            type: "card",
            billing_address: { ...SYNTHETIC_PERSONA.destination, id: undefined },
            // SIMULATED credential: the shape Alexa+ documents, with placeholder ciphertext. Never a real token.
            credential: { type: "encrypted_network_token", encrypted_token: "SIMULATED.eyJhbGci", encrypted_cryptogram: "SIMULATED.eyJhbGci", eci: "05", expiry_month: "09", expiry_year: "2028" },
            display: { brand: "visa", last_digits: "4242" },
          };
    const done = await this.client.complete(state.addon, sessionId, { payment: { instruments: [instrument] } }, traceId, randomUUID(), how.purchaseOrigin);
    if (done.status !== 200) throw new Error(`checkout complete answered ${done.status}: ${JSON.stringify(done.body).slice(0, 200)}`);
    const session = done.body as unknown as Session;
    const opts = options(session);
    let speak: string;
    if (session.status === "completed" && session.order) {
      speak = `Order placed. ${opt.simulated ? "This was a simulated payment, no money moved. " : opt.testMode ? "The store charged its Stripe account in test mode, no real money moved. " : ""}Your order number is ${session.order.id}.`;
    } else {
      const err = session.messages.find((m) => m.type === "error");
      speak = err ? err.content : "The payment did not go through.";
    }
    const next: CheckoutState = { sessionId, addon: state.addon, session, options: opts, speak };
    this.states.set(sessionId, next);
    return next;
  }

  async cancel(sessionId: string, traceId: string): Promise<CheckoutState> {
    const state = this.states.get(sessionId);
    if (!state) throw new Error("unknown checkout session");
    const res = await this.client.cancel(state.addon, sessionId, traceId, randomUUID());
    const session = res.status === 200 ? (res.body as unknown as Session) : state.session;
    const next: CheckoutState = { ...state, session, speak: "Checkout canceled. Nothing was charged." };
    this.states.set(sessionId, next);
    return next;
  }
}
