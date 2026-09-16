/**
 * The skeleton's "brain": a deterministic router from Household text to Bridge tools.
 * It exists so the Simulator works with fixed data before the Household agent (#8) lands,
 * and stays as Recorded mode's fallback. It never invents anything: every answer is the
 * tool's own voice text. The UI labels it "scripted router, no model".
 */
export type Intent =
  | { tool: "search_items"; arguments: { query?: string; limit?: number } }
  | { tool: "get_item"; arguments: { itemId: string } }
  | { tool: "ask_catalog"; arguments: { question: string } }
  | { tool: "get_policies"; arguments: Record<string, never> }
  | { tool: "start_checkout"; arguments: { items: Array<{ itemId: string; quantity: number }> } }
  | { tool: "get_order"; arguments: { orderId: string } }
  | { tool: "get_receipt"; arguments: { orderId: string } }
  | { tool: null; reply: string };

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

const POLICY_WORDS = /(polic|deliver|shipping|ship\b|pay\b|payment|accept|review|refund)/;
const ORDER_WORDS = /\bmy order\b|\bwhere is my\b|\border status\b|\bwhat did i (?:buy|order)\b|\bshow (?:me )?(?:the )?order\b/;
const RECEIPT_WORDS = /\breceipt\b|\bproof of purchase\b/;
const REORDER_WORDS = /\bsame as (?:last|the last) (?:week|time)\b|\bmy usual\b|\breorder\b|\border (?:it |that )?again\b|\bwhat i (?:had|got|ordered) last (?:week|time)\b/;
const NO_ORDER = "There is no order yet in this session.";

/** Words that ask about a property the item card may not state: the catalog agent answers those. */
const PROPERTY_WORDS = /gluten|vegan|organic|contain|allerg|ingredient|nuts?\b|milk|dairy|egg|sesame|soy|weigh|grams|how many|pieces|made (?:of|with|from)/i;

function clean(s: string): string {
  return s.trim().replace(/[?.!]+$/, "").trim();
}

/** Category words a catalog will not contain verbatim; what is left is the real filter. */
export function stripGeneric(q: string): string {
  return q
    .replace(/\b(?:bread|breads|things|items|products|food|stuff|everything|anything|options|some|any|kind of|sort of|do you have|are there|available|today|please)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Resolves a spoken item name to an id from what the last search returned. */
export function matchItem(name: string, known: Array<{ id: string; title: string }>): string | undefined {
  const n = name.toLowerCase().trim();
  if (!n) return undefined;
  const exact = known.find((k) => k.title.toLowerCase() === n || k.id === n);
  if (exact) return exact.id;
  const contains = known.find((k) => n.includes(k.title.toLowerCase()) || k.title.toLowerCase().includes(n));
  return contains?.id;
}

export interface RememberedOrder {
  orderId: string;
  lines: Array<{ itemId: string; title: string; quantity: number }>;
}

export function route(text: string, known: Array<{ id: string; title: string }>, lastOrderId?: string, remembered?: RememberedOrder): Intent {
  const t = clean(text).toLowerCase();
  if (!t) return { tool: null, reply: "Say what you would like to find, or ask about delivery and payment." };

  // "The same as last week": reorder from Household memory, references only.
  if (REORDER_WORDS.test(t)) {
    if (!remembered || remembered.lines.length === 0) return { tool: null, reply: "I do not have a previous order from this store to repeat." };
    return { tool: "start_checkout", arguments: { items: remembered.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity })) } };
  }

  // Orders and receipts: an explicit order id in the text, else the last order of the session.
  const orderRef = /\b(ord_[a-z0-9_-]+)\b/i.exec(clean(text))?.[1] ?? lastOrderId;
  if (RECEIPT_WORDS.test(t)) {
    return orderRef ? { tool: "get_receipt", arguments: { orderId: orderRef } } : { tool: null, reply: NO_ORDER };
  }
  if (ORDER_WORDS.test(t) && !/^(?:buy|order)\s/.test(t)) {
    return orderRef ? { tool: "get_order", arguments: { orderId: orderRef } } : { tool: null, reply: NO_ORDER };
  }

  const buy = /^(?:buy|order|add|i want|i'd like|get me)\s+(?:(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+)?(.+?)(?:\s+please)?$/.exec(t);
  if (buy) {
    const qty = buy[1] ? (NUMBER_WORDS[buy[1]] ?? Number(buy[1])) : 1;
    const itemId = matchItem(buy[2]!, known);
    if (itemId) return { tool: "start_checkout", arguments: { items: [{ itemId, quantity: qty }] } };
    return { tool: "search_items", arguments: { query: stripGeneric(buy[2]!), limit: 5 } };
  }

  const detail = /^(?:tell me (?:more )?about|what about|is|does|describe|details? (?:of|on)|show)\s+(?:the\s+)?(.+)$/.exec(t);
  if (detail) {
    // "is the X gluten free" / "does the X contain nuts": the item is the head of the phrase.
    const subject = detail[1]!.replace(/\s+(?:gluten[ -]free|vegan|organic|have\b.*|contain\b.*|come\b.*|weigh\b.*|made\b.*)$/, "");
    const itemId = matchItem(subject, known);
    // A question about a property of the item goes to the catalog agent with the words as said;
    // "tell me about X" stays with the item card.
    if (itemId && PROPERTY_WORDS.test(t) && /^(?:is|does|what|how)\b/.test(t)) return { tool: "ask_catalog", arguments: { question: text.trim() } };
    if (itemId) return { tool: "get_item", arguments: { itemId } };
    if (!POLICY_WORDS.test(t)) {
      const q = stripGeneric(subject);
      return { tool: "search_items", arguments: q ? { query: q, limit: 5 } : { limit: 5 } };
    }
  }

  if (POLICY_WORDS.test(t)) return { tool: "get_policies", arguments: {} };

  const search = /^(?:search(?: for)?|find|look for|do you have|do you sell|any|show me|what|which|i need|got)\s+(?:kind of\s+|sort of\s+)?(.+)$/.exec(t);
  const raw = search ? search[1]!.replace(/^(?:some|the|an?)\s+/, "") : clean(text);
  const q = stripGeneric(raw);
  return { tool: "search_items", arguments: q ? { query: q, limit: 5 } : { limit: 5 } };
}
