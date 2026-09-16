/**
 * PaymentRail: the Bridge's internal implementation of one Payment handler, executed through
 * the Store. The rail owns the Store checkout call; the checkout service never touches a
 * credential beyond handing it to the rail. Rails land in #9 (merchant PSP), #10 (Amazon,
 * simulated and labeled) and #17 (x402). See CONTEXT.md for handler versus rail.
 */
import type { AgentPosStoreClient } from "@agentpos-alexa/store-client";
import type { Logger } from "../logging.js";
import type { CheckoutSession, HandlerDeclaration, PaymentInstrument } from "../checkout/types.js";
import type { RegisteredStore } from "../storage/store-registry.js";

/** Store-side facts the checkout service keeps for a session and never exposes. */
export interface SessionInternal {
  slug: string;
  cartId?: string;
  cartExpiresAt?: string;
  checkoutUrl?: string;
  quoteTotalMinor?: string;
  settlementReference?: string;
  storeOrderId?: string;
  approvalId?: string;
  /** line item id -> Store item id */
  lineIndex: Record<string, string>;
}

export interface RailContext {
  store: RegisteredStore;
  storeClient: AgentPosStoreClient;
  session: CheckoutSession;
  internal: SessionInternal;
  instrument: PaymentInstrument;
  traceId: string;
  log: Logger;
}

export type RailOutcome =
  | {
      kind: "settled";
      /** Transaction hash or PSP charge id: the settlement reference orders are idempotent by. */
      settlementReference: string;
      storeOrderId: string;
      permalinkUrl: string;
      simulated: boolean;
    }
  | { kind: "declined"; code: string; content: string; simulated: boolean }
  | { kind: "parked"; approvalId: string; poll: string; expiresAt: string };

export type PspMode = "live" | "test_mode" | "simulated";

export interface PaymentRail {
  /** Reverse-domain handler namespace, e.g. dev.ucp.processor_tokenizer. */
  namespace: string;
  /** Handler id inside the namespace, unique per Store profile. */
  id: string;
  version: string;
  availableInstruments: unknown[];
  pspMode: PspMode;
  /** Extra fields for the profile declaration (config, spec, schema). */
  declarationExtras?: Record<string, unknown>;
  supports(store: RegisteredStore): boolean;
  settle(ctx: RailContext): Promise<RailOutcome>;
}

export class RailRegistry {
  private readonly rails: PaymentRail[] = [];

  register(rail: PaymentRail): this {
    if (this.rails.some((r) => r.namespace === rail.namespace && r.id === rail.id)) {
      throw new Error(`Rail ${rail.namespace}/${rail.id} already registered`);
    }
    this.rails.push(rail);
    return this;
  }

  forStore(store: RegisteredStore): PaymentRail[] {
    return this.rails.filter((r) => r.supports(store));
  }

  find(store: RegisteredStore, handlerId: string): PaymentRail | undefined {
    return this.forStore(store).find((r) => r.id === handlerId);
  }

  /** The ucp.payment_handlers block for a Store: profile and every session response. */
  declarations(store: RegisteredStore): Record<string, HandlerDeclaration[]> {
    const out: Record<string, HandlerDeclaration[]> = {};
    for (const r of this.forStore(store)) {
      const entry: HandlerDeclaration = {
        id: r.id,
        version: r.version,
        available_instruments: r.availableInstruments,
        ...(r.declarationExtras ?? {}),
      };
      if (r.pspMode === "simulated") entry.simulated = true;
      (out[r.namespace] ??= []).push(entry);
    }
    return out;
  }
}
