# AWS integration

Services used, why each, and where in the code. Updated as modules land.

| Service | Why | Where |
| --- | --- | --- |
| Amazon Bedrock (Nova 2 Lite, via Strands TypeScript) | the catalog agent behind `ask_catalog`: words the answer from published facts only; one usage_events row per call (`agent.catalog`) | `packages/agents/src/catalog.ts`, wired in `packages/bridge/src/mcp/server.ts` and `packages/bridge/src/main.ts` |
| Amazon Bedrock (Claude Sonnet 4.6, via Strands TypeScript) | the policy guardian's one spoken sentence at checkout completion, only when a rule fires; one usage_events row per call (`agent.guardian`) | `packages/agents/src/guardian.ts`, wired in `packages/bridge/src/checkout/service.ts` and `packages/bridge/src/main.ts` |
| Amazon Bedrock (Claude Sonnet 4.6, Nova Pro as fallback, via Strands TypeScript) | the onboarding agent: drafts the Voice overlay and voice policies from a Store's catalog, once per Store; the `catalog_draft` stage row carries the call | `packages/agents/src/onboarding.ts`, `packages/bridge/src/onboarding/service.ts`, wired in `packages/bridge/src/main.ts` |
| Bedrock AgentCore Runtime | hosts the merchant agents with traces for the demo | `packages/agents/deploy/*` (planned) |
| Bedrock AgentCore Memory | Household memory in the hosted runtime: one JSON event per order reference (add-on, order id, item ids, quantities), short-term only with no extraction strategies, 30-day event expiry; the memory is found by name or created at boot | `apps/simulator/src/server/agentcore-memory.ts`, selected in `apps/simulator/src/server/main.ts` with `SIMULATOR_MEMORY=agentcore` |
| Strands Agents SDK (TypeScript) | agent orchestration and tool use; our adapter wraps the Bridge's MCP tools (FL-004) | `apps/simulator/src/server/agent/household-agent.ts`; merchant agents in `packages/agents/src/*` (planned) |
| Amazon Bedrock (Nova 2 Lite, via Strands TypeScript) | the Household agent inside the Simulator: conversation, tool calls to the Bridge, one usage_events row per model call | `apps/simulator/src/server/agent/household-agent.ts`, `brain.ts`; prices in `packages/agents/src/pricing.ts` |
| Amazon Polly | voice output of the Simulator, per-phrase cache; browser speech as fallback | `apps/simulator/src/voice/*` (planned) |
| AWS App Runner | hosts the Bridge and the Simulator as two services with public URLs | `infra/apprunner.yaml` (planned) |

Two models per role keep the measured cost per closed checkout session under the target in
`docs/COSTS.md`. Region: us-east-1. Every agent and the Household memory sit behind one interface
with two runtimes: in-process and SQLite for a judge running locally, AgentCore Runtime and
AgentCore Memory for the hosted playground. Without AWS credentials the Scenes run in Recorded
mode and say so on screen.

What we learned while integrating is recorded in `docs/FRICTION-LOG.md`.
