# Deploying the hosted playground

> **2026-09-17:** App Runner is closed to new customers since 2026-04-30 (FL-008). The
> services run on Amazon ECS Express Mode instead: same image, one Fargate task each, HTTPS
> URLs generated at creation (`https://ag-<id>.ecs.us-east-1.on.aws`, FL-009). `pnpm deploy:aws` builds and
> deploys everything.

Target (#20): the Bridge, the Simulator and the fixture Store as three ECS Express Mode
services built from one image (`infra/Dockerfile`, service chosen by `SERVICE`), household memory on
AgentCore Memory, us-east-1. No Docker is needed locally: the image builds in CodeBuild from
this public repository and is pushed to ECR.

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

## Verified locally

The image's steps (frozen install, web build, entrypoint per service) run from a clean clone:
the three services start, the Simulator lists the Bridge's Store as an add-on and answers a
turn, and without AWS credentials every agent runs its deterministic path.
