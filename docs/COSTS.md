# Unit costs

Filled from the `usage_events` table (schema in `docs/USAGE-EVENTS.md`: tokens, latency, model, cost
per call). Two units: **store per month** (what the hosted tier charges) and **closed
checkout session** (the variable cost a store generates).

| Step | Model | Calls | Tokens in | Tokens out | Cost |
| --- | --- | --- | --- | --- | --- |
| Household agent, 3 turns to a started checkout (first measurement, 2026-09-16) | us.amazon.nova-2-lite-v1:0 | 6 | 16,406 | 189 | US$0.0010 (estimate table) |
| Catalog agent, one question (measured 2026-09-16, three questions averaged) | us.amazon.nova-2-lite-v1:0 | 1 | 948 | 38 | US$0.00007 (estimate table) |
| Voice-ready ranking and summaries | Nova 2 Lite | | | | |
| Policy guardian, one duplicate review (measured 2026-09-16; Sonnet gated by the use case form, FL-006) | us.amazon.nova-pro-v1:0 | 1 | 313 | 29 | US$0.0003 (estimate table) |
| Policy guardian, no rule fired | none | 0 | 0 | 0 | US$0 |
| Total per closed session | | | | | |

The first row comes from a real run against the fixture bakery: search, an item question and
"buy two sourdough loaves", each turn costing two model calls (tool use, then the answer).
Input tokens dominate because the six tool schemas travel with every call; prompt caching on
Bedrock is the obvious next lever. Prices are the estimate table in
`apps/simulator/src/server/agent/pricing.ts` until verified against the Bedrock pricing page.

Target: under US$0.05 per closed session in inference; hosted fixed cost under US$3 per store
per month. Pricing rule: list price between 3x and 10x unit cost. If the guardian makes a
session expensive, gate it to sessions above a threshold or use Nova Pro.

Export: `pnpm --filter @agentpos-alexa/bridge usage:export --summary` prints the totals for
this table; `usage:export --out docs/impact/usage-events.csv` writes the CSV committed with
the submission. Model rows appear once the agents run against Bedrock; until then every row
is a bridge or checkout event with zero tokens.
