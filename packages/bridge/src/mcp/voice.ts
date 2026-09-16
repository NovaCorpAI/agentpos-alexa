/**
 * Voice-ready text for tool results. Alexa+ speaks the first text block of a result, so it
 * must be short, pronounceable and free of markup, ids and URLs. Prices are integers in
 * minor units everywhere else; here they become words once, for the ear.
 */
import type { CatalogItem, QuoteLine } from "@agentpos-alexa/store-client";

const DECIMALS: Record<string, number> = { USDC: 7 };

/** "6.5 USDC" from minor units. Trailing zeros dropped, never more than 2 decimals spoken. */
export function speakPrice(minor: string, asset: string): string {
  const decimals = DECIMALS[asset] ?? 2;
  const digits = minor.padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const frac = digits.slice(digits.length - decimals).slice(0, 2).replace(/0+$/, "");
  const amount = frac ? `${whole}.${frac}` : whole;
  return `${amount} ${asset}`;
}

/** One spoken line per item: "Sourdough loaf, 6.5 USDC." */
export function speakItem(item: CatalogItem): string {
  return `${item.title}, ${speakPrice(item.price.minor, item.price.asset)}.`;
}

/** Spoken summary of a search: count, then up to `limit` items. */
export function speakSearch(items: CatalogItem[], query: string | undefined, limit = 3): string {
  if (items.length === 0) {
    return query ? `I did not find anything for ${query}.` : "The catalog is empty.";
  }
  const head = items.slice(0, limit).map((it) => `${it.title}, ${speakPrice(it.price.minor, it.price.asset)}`);
  const count = items.length === 1 ? "one item" : `${items.length} items`;
  const rest = items.length > limit ? `, and ${items.length - limit} more` : "";
  return `${query ? `For ${query}, ` : ""}I found ${count}: ${head.join("; ")}${rest}.`;
}

/** Spoken item detail, with the gluten-free fact when the catalog publishes it. */
export function speakItemDetail(item: CatalogItem): string {
  const parts = [speakItem(item), item.description.trim()];
  const gf = item.attributes?.glutenFree;
  if (gf === true) parts.push("It is gluten free.");
  if (gf === false) parts.push("It contains gluten.");
  return parts.join(" ");
}

/** Spoken quote: lines and total. */
export function speakQuote(lines: QuoteLine[], totalMinor: string, asset: string): string {
  const said = lines.map((l) => `${l.quantity} ${l.title}`).join(", ");
  return `${said}. Total ${speakPrice(totalMinor, asset)}.`;
}

/** Spoken order status: "Order 1001 is paid: 2 Baguette. Total 5.6 USDC." */
export function speakOrder(order: { externalOrderId?: string; orderId: string; status: string }, lines: Array<{ title: string; quantity: number }>, totalMinor: string | undefined, asset: string, simulated: boolean): string {
  const said = lines.length ? lines.map((l) => `${l.quantity} ${l.title}`).join(", ") : "your items";
  const status = order.status === "paid" ? "is paid" : order.status === "pending_approval" ? "is waiting for the merchant" : `is ${order.status.replace(/_/g, " ")}`;
  const total = totalMinor ? ` Total ${speakPrice(totalMinor, asset)}.` : "";
  const sim = simulated ? " This was a simulated payment: no money moved." : "";
  return `Order ${order.externalOrderId ?? order.orderId} ${status}: ${said}.${total}${sim}`;
}

/** Spoken receipt: verification result first, then the reference. */
export function speakReceipt(verification: { valid: boolean; mode?: string }, reference: string | undefined, count: number): string {
  const v = verification.mode === "fixture" ? "This is a fixture receipt, unsigned." : verification.valid ? "The store's signed receipt checks out." : "The receipt did not verify.";
  const ref = reference ? ` Settlement reference ${reference.slice(0, 18)}${reference.length > 18 ? " and so on" : ""}.` : "";
  return `${v} ${count === 1 ? "One receipt" : `${count} receipts`} on record.${ref}`;
}
