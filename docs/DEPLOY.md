# Deploying the hosted playground

> **2026-09-17:** App Runner is closed to new customers since 2026-04-30 (FL-008). The
> services run on Amazon ECS Express Mode instead: same image, one Fargate task each, HTTPS
> URLs generated at creation (`https://ag-<id>.ecs.us-east-1.on.aws`, FL-009). `pnpm deploy:aws` builds and
> deploys everything.

Target (#20): the Bridge, the Simulator and the fixture Store as three ECS Express Mode
services built from one image (`infra/Dockerfile`, service chosen by `SERVICE`), household memory on
AgentCore Memory, us-east-1. No Docker is needed locally: the image builds in CodeBuild from
this public repository and is pushed to ECR.

## Live (deployed 2026-09-17)

| Service | URL |
| --- | --- |
| Simulator | https://alexa.agentposhq.com/ |
| Merchant console | https://alexa.agentposhq.com/#/merchant |
| Bridge | https://bridge.agentposhq.com |
| Fixture Store | https://ag-8e0161c11f574824accc60bc26c8d2f4.ecs.us-east-1.on.aws |

Verified the same day against these URLs: Scene 5 (scan, draft on Claude Sonnet 4.6, publish,
7.7 s), Scene 1 (search, checkout with the simulated Amazon handler, order, receipt), Scene 2
(gluten free answered, organic "not published"), Scenes 3 and 4 ("the same as last week" from
AgentCore Memory, the guardian asks, the household confirms). URL to first voice purchase on
the fixture Store: 28 s.

To stop paying for the playground, set each service's task count to zero or delete the three
services in the ECS console; `pnpm deploy:aws` recreates them.

## Project domain names

The services answer on generated names (`https://ag-<id>.ecs.us-east-1.on.aws`). To serve them
under `agentposhq.com` with no proxy in front, so the rest of the domain keeps pointing at
Vercel untouched:

Done on 2026-09-19 for `alexa` and `bridge`; the certificate covers both names and the load
balancer has a host rule for each. To add another name:

1. Attach `infra/iam-deployer-domain-policy.json` to the development user (ACM, and the load
   balancer's listener and rules).
2. `pnpm domain:setup alexa.agentposhq.com=agentpos-alexa-sim bridge.agentposhq.com=agentpos-alexa-bridge`
3. Add the two validation CNAMEs it prints, in Cloudflare, DNS only. It waits for them.
4. When it finishes, point each name at the load balancer with a CNAME, DNS only:
   `ecs-express-gateway-alb-7147223b-979427678.us-east-1.elb.amazonaws.com`.
5. Redeploy with `PUBLIC_BRIDGE_URL=https://bridge.agentposhq.com` in `.env` so the Bridge
   publishes that name in its profile and checkout links.

## Permissions (one time, by the account owner)

The development IAM user starts with Bedrock and Polly only. Deployment and AgentCore need
the policy in `infra/iam-deployer-policy.json`, which is scoped to resources named
`agentpos-alexa*` wherever the service allows it:

1. IAM console, Policies, Create policy, JSON tab: paste the file, name it
   `agentpos-alexa-deployer`.
2. IAM console, Users, the development user, Add permissions, Attach policies directly:
   select `agentpos-alexa-deployer`.
3. Repeat both steps with `infra/iam-deployer-ecs-policy.json`, named
   `agentpos-alexa-deployer-ecs` (ECS Express Mode, read-only network lookups and its
   service-linked roles; the load balancer is created by the infrastructure role, not by the
   user).

## What the services receive

| Variable | Bridge | Simulator | Fixture Store |
| --- | --- | --- | --- |
| `SERVICE` | `bridge` | `simulator` | `fixture-store` |
| `BRIDGE_BASE_URL` | its own public URL | | |
| `AGENTPOS_STORE_URL` | the fixture Store's public URL | | |
| `BRIDGE_BEARER_TOKEN` | shared secret | same secret | |
| `BRIDGE_URL` | | the Bridge's public URL | |
| `FIXTURE_STORE_URL` | | | its own public URL |
| `SIMULATOR_MEMORY` | | `agentcore` | |
| `AWS_REGION`, `BEDROCK_MODEL_*` | yes | yes | |

AWS access comes from each service's task role (`agentpos-alexa-task`), never from
keys in the environment. The bearer token is generated at deploy time and kept only in the
services' configuration. SQLite lives on the instance's disk and resets on redeploy, which
suits a playground; orders of record live in the Store.

## What a redeploy must not lose

The task's disk goes with the task, so `pnpm deploy:aws` empties what was measured unless it
is taken out first. Two exports run before the services are replaced, and both are logged:

| What | From | Where it lands |
| --- | --- | --- |
| Waitlist | Simulator, `/api/waitlist/export` | `.data/waitlist-exports/waitlist-<timestamp>.csv`, never committed |
| usage_events | Bridge, `/admin/usage-events.csv` | `docs/impact/playground-usage-events.csv`, committed |

Both endpoints need the service's own token, which stays in its configuration. The usage
rows are merged by event id, so re-running an export changes nothing, and the committed file
is the playground's measured history across releases: the model calls, their tokens, their
latency and their cost. Nothing in a row names a buyer, an order or a card.

To merge an export taken by hand:

```bash
curl -H "Authorization: Bearer $BRIDGE_BEARER_TOKEN"   https://bridge.agentposhq.com/admin/usage-events.csv > rows.csv
node scripts/impact-export.mjs rows.csv
```

Commit the file it changed. `docs/impact/usage-events.csv` stays as it is: it is the measured
run behind `docs/COSTS.md`, not a running total.

## Verified locally

The image's steps (frozen install, web build, entrypoint per service) run from a clean clone:
the three services start, the Simulator lists the Bridge's Store as an add-on and answers a
turn, and without AWS credentials every agent runs its deterministic path.
