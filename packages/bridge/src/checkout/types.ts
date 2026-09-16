/**
 * UCP checkout session shapes (release 2026-04-08, the one Alexa+ pins), reduced to what the
 * Bridge produces and accepts. Vendored schemas: packages/bridge/vendor/ucp/2026-04-08.
 * Amounts are integers in the session currency's minor units (USD cents).
 */

export type SessionStatus =
  | "incomplete"
  | "requires_escalation"
  | "ready_for_complete"
  | "complete_in_progress"
  | "completed"
  | "canceled";

export type MessageSeverity = "recoverable" | "requires_buyer_input" | "requires_buyer_review" | "unrecoverable";

export interface MessageError {
  type: "error";
  code: string;
  content: string;
  severity: MessageSeverity;
  path?: string;
  content_type?: "plain" | "markdown";
}

export interface MessageInfo {
  type: "info";
  content: string;
  code?: string;
  path?: string;
}

export type Message = MessageError | MessageInfo;

export interface Total {
  type: string;
  amount: number;
  display_text?: string;
}

export interface Item {
  id: string;
  title: string;
  price: number;
  image_url?: string;
}

export interface LineItem {
  id: string;
  item: Item;
  quantity: number;
  totals: Total[];
}

export interface Buyer {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone_number?: string;
}

export interface Context {
  address_country?: string;
  address_region?: string;
  postal_code?: string;
  intent?: string;
  language?: string;
  currency?: string;
}

export interface PostalAddress {
  street_address?: string;
  extended_address?: string;
  address_locality?: string;
  address_region?: string;
  address_country?: string;
  postal_code?: string;
  first_name?: string;
  last_name?: string;
  phone_number?: string;
}

export interface ShippingDestination extends PostalAddress {
  id: string;
}

export interface FulfillmentMethod {
  id: string;
  type: string;
  line_item_ids: string[];
  selected_destination_id?: string | null;
  destinations?: ShippingDestination[];
}

export interface Fulfillment {
  methods?: FulfillmentMethod[];
}

export interface PaymentInstrument {
  id: string;
  handler_id: string;
  type: string;
  billing_address?: PostalAddress;
  credential?: { type: string; [key: string]: unknown };
  display?: Record<string, unknown>;
}

export interface Link {
  type: string;
  url: string;
  title?: string;
}

export interface HandlerDeclaration {
  id: string;
  version: string;
  available_instruments?: unknown[];
  [key: string]: unknown;
}

export interface UcpBlock {
  version: string;
  capabilities: Record<string, Array<{ version: string }>>;
  payment_handlers: Record<string, HandlerDeclaration[]>;
}

export interface CheckoutSession {
  ucp: UcpBlock;
  id: string;
  status: SessionStatus;
  currency: string;
  line_items: LineItem[];
  buyer?: Buyer;
  context?: Context;
  fulfillment?: Fulfillment;
  payment?: { instruments: PaymentInstrument[] };
  totals: Total[];
  messages: Message[];
  links: Link[];
  expires_at: string;
  continue_url?: string;
  order?: { id: string; permalink_url: string };
}

/** What the platform sends on create and update. Prices and titles are ignored, never trusted. */
export interface SessionRequest {
  line_items: Array<{ id?: string; item: { id: string; [key: string]: unknown }; quantity: number }>;
  buyer?: Buyer;
  context?: Context;
  fulfillment?: Fulfillment;
}

export interface CompleteRequest {
  payment: { instruments: PaymentInstrument[] };
}
