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

const KNOWN: Record<string, { label: string; labelEs: string; kind: "network_token" | "stored" | "tokenizer" | "unsupported" }> = {
  "com.agentposhq.processor_tokenizer": { label: "Card through the store's Stripe", labelEs: "Tarjeta por el Stripe de la tienda", kind: "tokenizer" },
  "com.amazon.payments.network_token": { label: "Amazon wallet card", labelEs: "Tarjeta de la billetera de Amazon", kind: "network_token" },
  "com.amazon.payments.stored_payment_method": { label: "Saved card", labelEs: "Tarjeta guardada", kind: "stored" },
  "org.x402.stellar": { label: "USDC wallet (x402)", labelEs: "Billetera USDC (x402)", kind: "unsupported" },
};

/** Words the host owns around a payment method, in the household's language. */
const PAY_WORDS = {
  "en-US": { testCard: "test card 4242", ending: "ending", card: "card", notWired: "not wired in the simulator yet", noLive: "live processors are not available to the demo household" },
  "es-CL": { testCard: "tarjeta de prueba 4242", ending: "terminada en", card: "tarjeta", notWired: "todavía no está conectada en el simulador", noLive: "los procesadores en vivo no están disponibles para el hogar de demostración" },
} as const;

export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function options(session: Session, language: SpokenLanguage = "en-US"): PaymentOption[] {
  const out: PaymentOption[] = [];
  const w = PAY_WORDS[language];
  const nameOf = (k: (typeof KNOWN)[string]) => (language === "es-CL" ? k.labelEs : k.label);
  for (const [ns, list] of Object.entries(session.ucp.payment_handlers)) {
    const known = KNOWN[ns];
    for (const h of list) {
      const testMode = h.test_mode === true || h.config?.environment === "sandbox";
      if (!known || known.kind === "unsupported") {
        out.push({ handlerId: h.id, namespace: ns, label: known ? nameOf(known) : ns, simulated: h.simulated === true, testMode, available: false, reason: w.notWired });
      } else if (known.kind === "tokenizer") {
        // The Demo household only has a processor test card; a live processor is not offered.
        out.push({ handlerId: h.id, namespace: ns, label: `${nameOf(known)} (${w.testCard})`, simulated: false, testMode, available: testMode, ...(testMode ? {} : { reason: w.noLive }) });
      } else if (known.kind === "stored") {
        for (const inst of session.payment?.instruments.filter((i) => i.handler_id === h.id) ?? []) {
          const d = inst.display ?? {};
          out.push({ handlerId: h.id, namespace: ns, label: `${nameOf(known)}: ${String(d.brand ?? w.card)} ${w.ending} ${String(d.last_digits ?? "")}`, simulated: h.simulated === true, testMode, instrumentId: inst.id, available: true });
        }
      } else {
        out.push({ handlerId: h.id, namespace: ns, label: nameOf(known), simulated: h.simulated === true, testMode, available: true });
      }
    }
  }
  return out;
}

function total(session: Session): number {
  return session.totals.find((t) => t.type === "total")?.amount ?? 0;
}

export type SpokenLanguage = "en-US" | "es-CL";

/** A session the household can still change: not paid, not canceled, not expired. */
export function isOpen(session: Session): boolean {
  return session.status !== "completed" && session.status !== "canceled" && session.status !== "expired";
}

function speakSession(session: Session, opts: PaymentOption[], language: SpokenLanguage, added = false): string {
  const lines = session.line_items.map((l) => `${l.quantity} ${l.item.title}`).join(", ");
  const es = language === "es-CL";
  const head = added ? (es ? "Agregado al carro. " : "Added to the cart. ") : "";
  if (session.status === "ready_for_complete") {
    const first = opts.find((o) => o.available);
    const label = first ? `${first.label}${first.simulated ? (es ? ", simulada" : ", simulated") : first.testMode ? (es ? ", en modo prueba" : ", in test mode") : ""}` : "";
    if (es) {
      return `${head}${lines}. Tu total es ${dollars(total(session))} con entrega en ${SYNTHETIC_PERSONA.destination.street_address}. ${first ? `¿Pago con tu ${label}?` : "No hay medio de pago disponible."}`;
    }
    return `${head}${lines}. Your total is ${dollars(total(session))} delivered to ${SYNTHETIC_PERSONA.destination.street_address}. ${first ? `Shall I pay with your ${label}?` : "No payment method is available."}`;
  }
  const err = session.messages.find((m) => m.type === "error");
  return err ? `${head}${lines}. ${err.content}` : `${head}${lines}.`;
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
  language?: SpokenLanguage;
}

export class CheckoutFlow {
  private readonly states = new Map<string, CheckoutState>();
  /** The open cart of each add-on, so another item joins it instead of starting a second one. */
  private readonly openByAddon = new Map<string, string>();

  constructor(private readonly client: BridgeCheckoutClient) {}

  get(sessionId: string): CheckoutState | undefined {
    return this.states.get(sessionId);
  }

  /** The cart this add-on still has open, if any: what a reloaded browser asks for. */
  openFor(addon: string): CheckoutState | undefined {
    const id = this.openByAddon.get(addon);
    const state = id ? this.states.get(id) : undefined;
    return state && isOpen(state.session) ? state : undefined;
  }

  /** The address the Store needs to quote delivery, attached to whatever lines are in the cart. */
  private fulfillment(session: Session) {
    return {
      methods: [
        {
          id: "shipping_1",
          type: "shipping",
          selected_destination_id: SYNTHETIC_PERSONA.destination.id,
          line_item_ids: session.line_items.map((l) => l.id),
          destinations: [SYNTHETIC_PERSONA.destination],
        },
      ],
    };
  }

  /**
   * Another item while a cart is open: the quantities are merged and the Store re-quotes the
   * whole cart. One session, one payment, the way a person would expect.
   */
  private async addLines(state: CheckoutState, lines: LineItemInput[], traceId: string, language: SpokenLanguage): Promise<CheckoutState> {
    const merged = new Map<string, number>();
    for (const l of state.session.line_items) merged.set(l.item.id, l.quantity);
    for (const l of lines) merged.set(l.itemId, (merged.get(l.itemId) ?? 0) + l.quantity);
    const body = {
      line_items: [...merged].map(([itemId, quantity]) => ({ item: { id: itemId }, quantity })),
      buyer: SYNTHETIC_PERSONA.buyer,
      context: { language, address_country: SYNTHETIC_PERSONA.destination.address_country },
    };
    const first = await this.client.update(state.addon, state.sessionId, body, traceId, randomUUID());
    if (first.status !== 200) throw new Error(`checkout update answered ${first.status}: ${JSON.stringify(first.body).slice(0, 200)}`);
    let session = first.body as unknown as Session;
    if (session.messages.some((m) => m.type === "error" && m.path?.startsWith("$.fulfillment"))) {
      const second = await this.client.update(state.addon, state.sessionId, { ...body, line_items: session.line_items.map((l) => ({ id: l.id, item: { id: l.item.id }, quantity: l.quantity })), fulfillment: this.fulfillment(session) }, traceId, randomUUID());
      if (second.status !== 200) throw new Error(`checkout update answered ${second.status}`);
      session = second.body as unknown as Session;
    }
    const opts = options(session, language);
    const next: CheckoutState = { sessionId: session.id, addon: state.addon, session, options: opts, speak: speakSession(session, opts, language, true) };
    this.states.set(session.id, next);
    return next;
  }

  /** Create, then update with the persona's address so the Store quotes it: one call for the host. */
  async start(addon: string, lines: LineItemInput[], traceId: string, language: SpokenLanguage = "en-US"): Promise<CheckoutState> {
    const open = this.openFor(addon);
    if (open) return this.addLines(open, lines, traceId, language);
    const created = await this.client.create(addon, { line_items: lines.map((l) => ({ item: { id: l.itemId }, quantity: l.quantity })), buyer: SYNTHETIC_PERSONA.buyer, context: { language, address_country: SYNTHETIC_PERSONA.destination.address_country } }, traceId, randomUUID());
    if (created.status !== 201) throw new Error(`checkout create answered ${created.status}: ${JSON.stringify(created.body).slice(0, 200)}`);
    let session = created.body as unknown as Session;
    const needsAddress = session.messages.some((m) => m.type === "error" && m.path?.startsWith("$.fulfillment"));
    if (needsAddress) {
      const updated = await this.client.update(addon, session.id, {
        line_items: session.line_items.map((l) => ({ id: l.id, item: { id: l.item.id }, quantity: l.quantity })),
        buyer: SYNTHETIC_PERSONA.buyer,
        context: { language, address_country: SYNTHETIC_PERSONA.destination.address_country },
        fulfillment: this.fulfillment(session),
      }, traceId, randomUUID());
      if (updated.status !== 200) throw new Error(`checkout update answered ${updated.status}`);
      session = updated.body as unknown as Session;
    }
    const opts = options(session, language);
    const state: CheckoutState = { sessionId: session.id, addon, session, options: opts, speak: speakSession(session, opts, language) };
    this.states.set(session.id, state);
    this.openByAddon.set(addon, session.id);
    return state;
  }

  /** Complete with the chosen option's credential. Simulated credentials are labeled as such. */
  async confirm(sessionId: string, handlerId: string, instrumentId: string | undefined, traceId: string, how: ConfirmOptions = {}): Promise<CheckoutState> {
    const state = this.states.get(sessionId);
    if (!state) throw new Error("unknown checkout session");
    const opt = state.options.find((o) => o.handlerId === handlerId && (instrumentId ? o.instrumentId === instrumentId : true) && o.available);
    if (!opt) throw new Error("that payment option is not available");
    const es = how.language === "es-CL";
    if (how.mandate) {
      const refusal = !opt.simulated && !opt.testMode
        ? es
          ? "El hogar de demostración solo puede pagar con métodos simulados o en modo prueba. Trae tu propia billetera para comprar de verdad."
          : "The demo household can only pay with simulated or test mode methods. Bring your own wallet to buy for real."
        : total(state.session) > how.mandate.maxTotalCents
          ? es
            ? `Eso pasa el límite del hogar de demostración, que es ${dollars(how.mandate.maxTotalCents)} por pedido. Prueba con menos productos.`
            : `That is above the demo household's limit of ${dollars(how.mandate.maxTotalCents)} per order. Try fewer items.`
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
    const opts = options(session, how.language ?? "en-US");
    let speak: string;
    if (session.status === "completed" && session.order) {
      const how_paid = opt.simulated
        ? es
          ? "Fue un pago simulado, no se movió dinero. "
          : "This was a simulated payment, no money moved. "
        : opt.testMode
          ? es
            ? "La tienda cobró en su cuenta de Stripe en modo prueba, no se movió dinero real. "
            : "The store charged its Stripe account in test mode, no real money moved. "
          : "";
      speak = es ? `Pedido hecho. ${how_paid}Tu número de pedido es ${session.order.id}.` : `Order placed. ${how_paid}Your order number is ${session.order.id}.`;
    } else {
      const err = session.messages.find((m) => m.type === "error");
      speak = err ? err.content : es ? "El pago no se pudo completar." : "The payment did not go through.";
    }
    const next: CheckoutState = { sessionId, addon: state.addon, session, options: opts, speak };
    this.states.set(sessionId, next);
    if (!isOpen(session)) this.openByAddon.delete(state.addon);
    return next;
  }

  async cancel(sessionId: string, traceId: string, language: SpokenLanguage = "en-US"): Promise<CheckoutState> {
    const state = this.states.get(sessionId);
    if (!state) throw new Error("unknown checkout session");
    const res = await this.client.cancel(state.addon, sessionId, traceId, randomUUID());
    const session = res.status === 200 ? (res.body as unknown as Session) : state.session;
    const next: CheckoutState = { ...state, session, speak: language === "es-CL" ? "Checkout cancelado. No se cobró nada." : "Checkout canceled. Nothing was charged." };
    this.states.set(sessionId, next);
    this.openByAddon.delete(state.addon);
    return next;
  }
}
