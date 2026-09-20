# AWS integration

Services used, why each, and where in the code. Updated as modules land.

| Service | Why | Where |
| --- | --- | --- |
| Amazon Bedrock (Nova 2 Lite, via Strands TypeScript) | the catalog agent behind `ask_catalog`: words the answer from published facts only; one usage_events row per call (`agent.catalog`) | `packages/agents/src/catalog.ts`, wired in `packages/bridge/src/mcp/server.ts` and `packages/bridge/src/main.ts` |
| Amazon Bedrock (Claude Sonnet 4.6, via Strands TypeScript) | the policy guardian's one spoken sentence at checkout completion, only when a rule fires; one usage_events row per call (`agent.guardian`) | `packages/agents/src/guardian.ts`, wired in `packages/bridge/src/checkout/service.ts` and `packages/bridge/src/main.ts` |
| Amazon Bedrock (Claude Sonnet 4.6, Nova Pro as fallback, via Strands TypeScript) | the onboarding agent: drafts the Voice overlay and voice policies from a Store's catalog, once per Store; the `catalog_draft` stage row carries the call | `packages/agents/src/onboarding.ts`, `packages/bridge/src/onboarding/service.ts`, wired in `packages/bridge/src/main.ts` |
| Bedrock AgentCore Memory | Household memory in the hosted runtime: one JSON event per order reference (add-on, order id, item ids, quantities), short-term only with no extraction strategies, 30-day event expiry; the memory is found by name or created at boot | `apps/simulator/src/server/agentcore-memory.ts`, selected in `apps/simulator/src/server/main.ts` with `SIMULATOR_MEMORY=agentcore` |
| Strands Agents SDK (TypeScript) | agent orchestration, tool use and prompt caching for all four agents; our own adapter wraps the Bridge's MCP tools, because the SDK's MCP client drops structuredContent (FL-004) | `apps/simulator/src/server/agent/household-agent.ts`, `packages/agents/src/*`, `packages/agents/src/cache.ts` |
| Amazon Bedrock (Nova 2 Lite, via Strands TypeScript) | the Household agent inside the Simulator: conversation, tool calls to the Bridge, one usage_events row per model call | `apps/simulator/src/server/agent/household-agent.ts`, `brain.ts`; prices in `packages/agents/src/pricing.ts` |
| Amazon Polly | voice output of the Simulator (generative voices), per-phrase cache; browser speech as fallback | `apps/simulator/src/server/speech.ts` |
| Amazon ECS Express Mode (Fargate), Amazon ECR, AWS CodeBuild | the hosted playground: one image built in CodeBuild from the public repository, three Express Mode services (Bridge, Simulator, fixture Store) with a task role limited to Bedrock, Polly and AgentCore Memory; App Runner is closed to new customers (FL-008) | `infra/Dockerfile`, `infra/entrypoint.sh`, `scripts/deploy-aws.mjs`, `docs/DEPLOY.md` |

Two models per role keep the measured cost per closed checkout session at US$0.0021, under the
target in `docs/COSTS.md`; Bedrock prompt caching takes 28 percent off the Household agent
(FL-011). Region: us-east-1.

The merchant agents run in-process inside the Bridge, which is itself a container on ECS
Express Mode: one process, one deployment, no second runtime to operate. They sit behind an
interface so they can move to AgentCore Runtime when the hosted playground needs its own
traces, and nothing above them changes. The Household memory already has both runtimes:
SQLite for a judge running locally, AgentCore Memory in the deployment.

Every agent runs a deterministic rule before it calls a model, so without AWS credentials the
whole demo still runs and says on screen which brain is answering.

What we learned while integrating is recorded in `docs/FRICTION-LOG.md`.
