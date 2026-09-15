# Unit costs

Filled from the `usage_events` table (schema in `docs/USAGE-EVENTS.md`: tokens, latency, model, cost
per call). Two units: **store per month** (what the hosted tier charges) and **closed
checkout session** (the variable cost a store generates).

| Step | Model | Calls | Tokens in | Tokens out | Cost |
| --- | --- | --- | --- | --- | --- |
| Catalog agent (in conversation) | Nova 2 Lite | | | | |
| Voice-ready ranking and summaries | Nova 2 Lite | | | | |
| Policy guardian (only at completion) | Claude Sonnet via Bedrock | | | | |
| Total per closed session | | | | | |

Target: under US$0.05 per closed session in inference; hosted fixed cost under US$3 per store
per month. Pricing rule: list price between 3x and 10x unit cost. If the guardian makes a
session expensive, gate it to sessions above a threshold or use Nova Pro.

Export: `pnpm --filter @agentpos-alexa/bridge usage:export` (planned) writes a CSV.
