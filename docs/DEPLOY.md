# Deploying the hosted playground

Target (#20): the Bridge, the Simulator and the fixture Store as three App Runner services
built from one image (`infra/Dockerfile`, service chosen by `SERVICE`), household memory on
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

AWS access comes from each service's instance role (`agentpos-alexa-instance`), never from
keys in the environment. The bearer token is generated at deploy time and kept only in the
services' configuration. SQLite lives on the instance's disk and resets on redeploy, which
suits a playground; orders of record live in the Store.

## Verified locally

The image's steps (frozen install, web build, entrypoint per service) run from a clean clone:
the three services start, the Simulator lists the Bridge's Store as an add-on and answers a
turn, and without AWS credentials every agent runs its deterministic path.
