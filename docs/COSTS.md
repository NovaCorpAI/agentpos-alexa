# Unit costs

Filled from the `usage_events` table (schema in `docs/USAGE-EVENTS.md`: tokens, latency, model, cost
per call). Two units: **store per month** (what the hosted tier charges) and **closed
checkout session** (the variable cost a store generates).

## Per closed checkout session (measured)

Five closed sessions on 2026-09-17 against the fixture bakery, each one the way a household
shops: "What bread do you have?", a question about one item, "Buy one" of it, confirm. Three
of the five repeated an order placed earlier that day, so the guardian asked and the household
said yes. Every model call of the window is in `docs/impact/usage-events.csv` (63 rows).

| Source | Model | Calls | Tokens in | Tokens out | Cost |
| --- | --- | --- | --- | --- | --- |
| Household agent | us.amazon.nova-2-lite-v1:0 | 31 | 89,636 | 963 | US$0.0056 |
| Catalog agent | us.amazon.nova-2-lite-v1:0 | 3 | 4,549 | 108 | US$0.0003 |
| Policy guardian (3 reviews) | us.anthropic.claude-sonnet-4-6 | 3 | 906 | 125 | US$0.0046 |
| **Total, 5 closed sessions** | | 37 | | | **US$0.0105** |
| **Per closed session** | | | | | **US$0.0021** |

### With prompt caching (2026-09-17, same five sessions)

Bedrock prompt caching on the static prefix of every agent prompt, measured on the same run
(`docs/impact/usage-events-cached.csv`):

| Source | Model | Calls | Cost before | Cost with cache | Cached reads |
| --- | --- | --- | --- | --- | --- |
| Household agent | us.amazon.nova-2-lite-v1:0 | 31 | US$0.0059 | US$0.0043 | 30,584 tokens |
| Catalog agent | us.amazon.nova-2-lite-v1:0 | 3 | US$0.0003 | US$0.0003 | 592 tokens |
| Policy guardian | us.anthropic.claude-sonnet-4-6 | per review | US$0.0015 | US$0.0015 | none |

The Household agent is 28 percent cheaper: its system prompt and tool schemas, about 2,300
tokens, now cost a tenth on every call after the first. The guardian gains nothing because its
prompt is around 300 tokens, under Bedrock's 1,024-token minimum for a cache checkpoint. With
the guardian firing in three sessions out of five, as in the first run, a closed session costs
**US$0.0018**. Nova needed the strategy named by hand and accepts the system checkpoint only
(FL-011).

That is about 24 times under the US$0.05 target. The guardian is 44 percent of the cost while
it fires in three sessions out of five; in normal use it fires rarely and a session costs
about US$0.0012. Input tokens are 99 percent of the Household agent's volume (seven tool
schemas travel with every call), which is what prompt caching now covers.

Onboarding is per Store, not per session: one draft of 8 items costs US$0.0167 on Claude
Sonnet 4.6, once.

Reproduce: run the paced sessions, then
`pnpm --filter @agentpos-alexa/bridge usage:export --summary --since <start ISO>`, which reads
the Bridge and Simulator databases together and divides the window's model cost by the
checkout sessions completed in it.

## Per step

| Step | Model | Calls | Tokens in | Tokens out | Cost |
| --- | --- | --- | --- | --- | --- |
| Household agent, 3 turns to a started checkout (first measurement, 2026-09-16) | us.amazon.nova-2-lite-v1:0 | 6 | 16,406 | 189 | US$0.0010 (estimate table) |
| Catalog agent, one question (measured 2026-09-16, three questions averaged) | us.amazon.nova-2-lite-v1:0 | 1 | 948 | 38 | US$0.00007 (estimate table) |
| Voice-ready ranking and summaries | Nova 2 Lite | | | | |
| Policy guardian, one duplicate review (measured 2026-09-16; Sonnet gated by the use case form, FL-006) | us.amazon.nova-pro-v1:0 | 1 | 313 | 29 | US$0.0003 (estimate table) |
| Policy guardian, one duplicate review (measured 2026-09-16, after the use case form) | us.anthropic.claude-sonnet-4-6 | 1 | 300 | 38 | US$0.0015 (estimate table) |
| Onboarding draft, 8 items (measured 2026-09-16, after the use case form) | us.anthropic.claude-sonnet-4-6 | 1 | 1,618 | 791 | US$0.0167 (estimate table) |
| Policy guardian, no rule fired | none | 0 | 0 | 0 | US$0 |
| Onboarding draft, 8 items (measured 2026-09-16; Sonnet gated by the use case form, FL-006) | us.amazon.nova-pro-v1:0 | 1 | 1,409 | 555 | US$0.0029 (estimate table) |

The first row comes from a real run against the fixture bakery: search, an item question and
"buy two sourdough loaves", each turn costing two model calls (tool use, then the answer).
Input tokens dominate because the six tool schemas travel with every call; prompt caching on
Bedrock is the obvious next lever. Prices are the estimate table in
`apps/simulator/src/server/agent/pricing.ts` until verified against the Bedrock pricing page.

Target: under US$0.05 per closed session in inference; hosted fixed cost under US$3 per store
per month. Pricing rule: list price between 3x and 10x unit cost. If the guardian makes a
session expensive, gate it to sessions above a threshold or use Nova Pro.

Export: `pnpm --filter @agentpos-alexa/bridge usage:export --summary [--since ISO]` prints the
totals; `usage:export --since ISO --out docs/impact/usage-events.csv` writes the CSV committed
with the submission, and the CSV reads back into the same events (tested round trip).

The hosted playground writes its rows to a disk the next release replaces, so `pnpm
deploy:aws` exports the Bridge's rows first and merges them into
`docs/impact/playground-usage-events.csv`, which is committed (docs/DEPLOY.md). That file is
the running history of what the public playground actually cost; the numbers above come from
the measured run in `docs/impact/usage-events.csv` and do not move with it.
