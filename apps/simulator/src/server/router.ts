/**
 * The skeleton's "brain": a deterministic router from Household text to Bridge tools.
 * It exists so the Simulator works with fixed data before the Household agent (#8) lands,
 * and stays as Recorded mode's fallback. It never invents anything: every answer is the
 * tool's own voice text. The UI labels it "scripted router, no model".
 */
export type Intent =
  | { tool: "search_items"; arguments: { query?: string; limit?: number } }
  | { tool: "get_item"; arguments: { itemId: string } }
  | { tool: "get_policies"; arguments: Record<string, never> }
  | { tool: "start_checkout"; arguments: { items: Array<{ itemId: string; quantity: number }> } }
  | { tool: null; reply: string };

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

const POLICY_WORDS = /(polic|deliver|shipping|ship\b|pay\b|payment|accept|review|refund)/;

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

export function route(text: string, known: Array<{ id: string; title: string }>): Intent {
  const t = clean(text).toLowerCase();
  if (!t) return { tool: null, reply: "Say what you would like to find, or ask about delivery and payment." };

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
    const subject = detail[1]!.replace(/\s+(?:gluten[ -]free|vegan|have\b.*|contain\b.*|come\b.*|weigh\b.*)$/, "");
    const itemId = matchItem(subject, known);
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
