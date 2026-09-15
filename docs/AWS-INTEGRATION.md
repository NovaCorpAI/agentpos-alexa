# AWS integration

Services used, why each, and where in the code. Updated as modules land.

| Service | Why | Where |
| --- | --- | --- |
| Amazon Bedrock (Nova 2 Lite) | frequent, cheap steps: catalog answers, ranking, voice-ready summaries | `packages/agents/src/catalog/*` (planned) |
| Amazon Bedrock (Claude Sonnet or Nova Pro) | rare, critical decisions: onboarding draft, policy guardian | `packages/agents/src/onboarding/*`, `packages/agents/src/guardian/*` (planned) |
| Bedrock AgentCore Runtime | hosts the merchant agents with traces for the demo | `packages/agents/deploy/*` (planned) |
| Bedrock AgentCore Memory | per-store preferences and rules across sessions | `packages/agents/src/memory.ts` (planned) |
| Strands Agents SDK | agent orchestration and tool use | `packages/agents/src/*` (planned) |
| Amazon Bedrock (Nova 2 Lite, via Strands TypeScript) | the Household agent inside the Simulator: conversation, tool calls to the Bridge | `apps/simulator/src/agent/*` (planned) |
| Amazon Polly | voice output of the Simulator, per-phrase cache; browser speech as fallback | `apps/simulator/src/voice/*` (planned) |
| AWS App Runner | hosts the Bridge and the Simulator as two services with public URLs | `infra/apprunner.yaml` (planned) |

Two models per role keep the measured cost per closed checkout session under the target in
`docs/COSTS.md`. Region: us-east-1. Every agent and the Household memory sit behind one interface
with two runtimes: in-process and SQLite for a judge running locally, AgentCore Runtime and
AgentCore Memory for the hosted playground. Without AWS credentials the Scenes run in Recorded
mode and say so on screen.

What we learned while integrating is recorded in `docs/FRICTION-LOG.md`.
