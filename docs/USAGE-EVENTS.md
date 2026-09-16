# usage_events

One row per model call and per measured stage, written by the bridge, the agents and the
simulator into the same SQLite table (`packages/bridge/src/storage/usage-events.ts`). It feeds
`docs/COSTS.md` and the impact numbers in the submission. Defined before any module writes to
it so the numbers are comparable across components.

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | text | ULID or UUID assigned by the writer |
| `trace_id` | text | crosses MCP call, checkout session, store request and settlement |
| `at` | text | ISO 8601 UTC |
| `source` | text | `bridge.mcp`, `bridge.checkout`, `agent.onboarding`, `agent.catalog`, `agent.catalog` (one row per `ask_catalog` call that reached the model; none when the facts answered alone), `agent.guardian` (one row per checkout where a rule fired; `model` null when the rule spoke without a model), `simulator` |
| `store_origin` | text | the store the event belongs to |
| `checkout_session_id` | text, nullable | set on checkout and rail events |
| `model` | text, nullable | Bedrock model id; null for stage marks and rail calls |
| `input_tokens`, `output_tokens` | integer | zero for non-model events |
| `latency_ms` | integer | wall time of the call or stage |
| `estimated_cost_usd_micros` | integer | 1 USD = 1,000,000. Never a float |
| `onboarding_stage` | text, nullable | `scan`, `catalog_draft`, `policies_draft`, `human_confirm`, `published`, `first_voice_purchase` |
| `purchase_origin` | text, nullable | `own` (our team, tests) or `third_party` (public simulator) |
| `payment_handler` | text, nullable | handler id on rail events, e.g. `dev.ucp.processor_tokenizer` |
| `simulated` | integer 0/1 | 1 when the rail or PSP behind the event is simulated. Always written, never inferred |
| `psp_mode` | text, nullable | `live`, `test_mode` or `simulated` on rail events (see CONTEXT.md) |

## Questions the table answers

- **Onboarding time per store**: difference between `scan` and `first_voice_purchase` for the
  same `store_origin`. Reported as the median over 5 stores.
- **Cost per closed checkout session**: sum of `estimated_cost_usd_micros` grouped by
  `checkout_session_id`, split by `source`.
- **Third-party purchases**: count of completed sessions with `purchase_origin = third_party`
  and `simulated = 0`.
- **Simulated versus real**: nothing labeled simulated is ever counted as a real purchase.

## Export

`pnpm --filter @agentpos-alexa/bridge usage:export` writes the CSV to stdout (`--out file.csv`
for a file) with the columns above in the order of `USAGE_EVENTS_CSV_COLUMNS`; `--summary`
prints the per-source and per-session totals that `docs/COSTS.md` reports. No PII is stored: no
addresses, emails or names; the household is referenced only through the checkout session.
