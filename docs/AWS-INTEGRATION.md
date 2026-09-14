# AWS integration

Services used, why each, and where in the code. Updated as modules land.

| Service | Why | Where |
| --- | --- | --- |
| Amazon Bedrock (Nova 2 Lite) | frequent, cheap steps: catalog answers, ranking, voice-ready summaries | `packages/agents/src/catalog/*` (planned) |
| Amazon Bedrock (Claude Sonnet or Nova Pro) | rare, critical decisions: onboarding draft, policy guardian | `packages/agents/src/onboarding/*`, `packages/agents/src/guardian/*` (planned) |
| Bedrock AgentCore Runtime | hosts the merchant agents with traces for the demo | `packages/agents/deploy/*` (planned) |
| Bedrock AgentCore Memory | per-store preferences and rules across sessions | `packages/agents/src/memory.ts` (planned) |
| Strands Agents SDK | agent orchestration and tool use | `packages/agents/src/*` (planned) |
| AWS App Runner | hosts the bridge and the simulator for judges | `infra/apprunner.yaml` (planned) |

Two models per role keep the measured cost per closed checkout session under the target in
`docs/COSTS.md`. Region: us-east-1.

What we learned while integrating is recorded in `docs/FRICTION-LOG.md`.
