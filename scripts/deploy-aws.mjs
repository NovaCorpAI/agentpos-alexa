#!/usr/bin/env node
/**
 * Deploys the hosted playground (#20): builds infra/Dockerfile in CodeBuild from the public
 * GitHub repository, pushes it to ECR, and creates or updates three App Runner services
 * (fixture-store, bridge, simulator). Idempotent: every resource is found by name first.
 *
 *   node scripts/deploy-aws.mjs [--skip-build] [--ref main]
 *
 * AWS access comes from the environment or .env (AWS_* only are read from it). Nothing
 * secret is printed; the Bridge bearer token lives only in the services' configuration.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { AppRunnerClient, CreateServiceCommand, DescribeServiceCommand, ListServicesCommand, UpdateServiceCommand } from "@aws-sdk/client-apprunner";
import { BatchGetBuildsCommand, BatchGetProjectsCommand, CodeBuildClient, CreateProjectCommand, StartBuildCommand, UpdateProjectCommand } from "@aws-sdk/client-codebuild";
import { CreateRepositoryCommand, DescribeRepositoriesCommand, ECRClient } from "@aws-sdk/client-ecr";
import { AttachRolePolicyCommand, CreateRoleCommand, GetRoleCommand, IAMClient, PutRolePolicyCommand } from "@aws-sdk/client-iam";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { BedrockAgentCoreControlClient, ListMemoriesCommand } from "@aws-sdk/client-bedrock-agentcore-control";

const root = resolve(import.meta.dirname, "..");
const envFile = resolve(root, ".env");
const fileEnv = {};
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) fileEnv[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  for (const [k, v] of Object.entries(fileEnv)) if (k.startsWith("AWS_") && !process.env[k]) process.env[k] = v;
}

const args = process.argv.slice(2);
const skipBuild = args.includes("--skip-build");
const ref = args[args.indexOf("--ref") + 1] && args.includes("--ref") ? args[args.indexOf("--ref") + 1] : "main";
const region = process.env.AWS_REGION || "us-east-1";
const NAME = "agentpos-alexa";
const REPO_URL = "https://github.com/NovaCorpAI/agentpos-alexa.git";
const cfg = (k, d) => process.env[k] || fileEnv[k] || d;

const log = (msg, extra = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), msg, ...extra }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const notFound = (e) => ["NoSuchEntityException", "NoSuchEntity", "RepositoryNotFoundException", "ResourceNotFoundException"].includes(e?.name);

const { Account: account } = await new STSClient({ region }).send(new GetCallerIdentityCommand({}));
const iam = new IAMClient({ region });
const ecr = new ECRClient({ region });
const codebuild = new CodeBuildClient({ region });
const apprunner = new AppRunnerClient({ region });
const imageUri = `${account}.dkr.ecr.${region}.amazonaws.com/${NAME}`;

async function ensureRole(roleName, trustService, { managed = [], inline } = {}) {
  let arn;
  try {
    arn = (await iam.send(new GetRoleCommand({ RoleName: roleName }))).Role.Arn;
  } catch (e) {
    if (!notFound(e)) throw e;
    const trust = { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: trustService }, Action: "sts:AssumeRole" }] };
    arn = (await iam.send(new CreateRoleCommand({ RoleName: roleName, AssumeRolePolicyDocument: JSON.stringify(trust), Tags: [{ Key: "project", Value: NAME }] }))).Role.Arn;
    log("role created", { roleName });
    await sleep(10_000); // IAM is eventually consistent; a fresh role is not assumable at once.
  }
  for (const policyArn of managed) await iam.send(new AttachRolePolicyCommand({ RoleName: roleName, PolicyArn: policyArn }));
  if (inline) await iam.send(new PutRolePolicyCommand({ RoleName: roleName, PolicyName: `${roleName}-inline`, PolicyDocument: JSON.stringify(inline) }));
  return arn;
}

// 1. Registry.
try {
  await ecr.send(new DescribeRepositoriesCommand({ repositoryNames: [NAME] }));
} catch (e) {
  if (!notFound(e)) throw e;
  await ecr.send(new CreateRepositoryCommand({ repositoryName: NAME, imageScanningConfiguration: { scanOnPush: true }, tags: [{ Key: "project", Value: NAME }] }));
  log("ecr repository created", { imageUri });
}

// 2. Roles: image build, App Runner's pull from ECR, and the services' own AWS access.
const buildRole = await ensureRole(`${NAME}-codebuild`, "codebuild.amazonaws.com", {
  inline: {
    Version: "2012-10-17",
    Statement: [
      { Effect: "Allow", Action: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"], Resource: "*" },
      { Effect: "Allow", Action: ["ecr:GetAuthorizationToken"], Resource: "*" },
      { Effect: "Allow", Action: ["ecr:BatchCheckLayerAvailability", "ecr:CompleteLayerUpload", "ecr:InitiateLayerUpload", "ecr:PutImage", "ecr:UploadLayerPart", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"], Resource: `arn:aws:ecr:${region}:${account}:repository/${NAME}` },
    ],
  },
});
const accessRole = await ensureRole(`${NAME}-apprunner-ecr`, "build.apprunner.amazonaws.com", { managed: ["arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess"] });
const instanceRole = await ensureRole(`${NAME}-instance`, "tasks.apprunner.amazonaws.com", {
  inline: {
    Version: "2012-10-17",
    Statement: [
      { Effect: "Allow", Action: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock:Converse", "bedrock:ConverseStream"], Resource: "*" },
      { Effect: "Allow", Action: ["polly:SynthesizeSpeech", "polly:DescribeVoices"], Resource: "*" },
      { Effect: "Allow", Action: ["bedrock-agentcore:CreateEvent", "bedrock-agentcore:ListEvents", "bedrock-agentcore:GetMemory", "bedrock-agentcore:ListMemories"], Resource: "*" },
    ],
  },
});

// 3. Image, built in CodeBuild from the public repository.
if (!skipBuild) {
  const buildspec = [
    "version: 0.2",
    "phases:",
    "  pre_build:",
    "    commands:",
    `      - aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${account}.dkr.ecr.${region}.amazonaws.com`,
    "  build:",
    "    commands:",
    `      - docker build -f infra/Dockerfile -t ${imageUri}:latest -t ${imageUri}:$CODEBUILD_RESOLVED_SOURCE_VERSION .`,
    "  post_build:",
    "    commands:",
    `      - docker push ${imageUri}:latest`,
    `      - docker push ${imageUri}:$CODEBUILD_RESOLVED_SOURCE_VERSION`,
  ].join("\n");
  const project = {
    name: `${NAME}-image`,
    source: { type: "GITHUB", location: REPO_URL, gitCloneDepth: 1, buildspec },
    artifacts: { type: "NO_ARTIFACTS" },
    environment: { type: "LINUX_CONTAINER", image: "aws/codebuild/amazonlinux-x86_64-standard:5.0", computeType: "BUILD_GENERAL1_MEDIUM", privilegedMode: true },
    serviceRole: buildRole,
    timeoutInMinutes: 30,
  };
  const existing = await codebuild.send(new BatchGetProjectsCommand({ names: [project.name] }));
  if (existing.projects?.length) await codebuild.send(new UpdateProjectCommand(project));
  else {
    for (let attempt = 0; ; attempt++) {
      try {
        await codebuild.send(new CreateProjectCommand(project));
        break;
      } catch (e) {
        if (attempt < 5 && /not authorized to perform sts:AssumeRole|role/i.test(String(e?.message))) { await sleep(10_000); continue; }
        throw e;
      }
    }
    log("codebuild project created", { project: project.name });
  }
  const { build } = await codebuild.send(new StartBuildCommand({ projectName: project.name, sourceVersion: ref }));
  log("image build started", { buildId: build.id, ref });
  for (;;) {
    await sleep(20_000);
    const b = (await codebuild.send(new BatchGetBuildsCommand({ ids: [build.id] }))).builds[0];
    if (b.buildStatus !== "IN_PROGRESS") {
      log("image build finished", { status: b.buildStatus, phase: b.phases?.filter((p) => p.phaseStatus && p.phaseStatus !== "SUCCEEDED").map((p) => `${p.phaseType}:${p.phaseStatus}`) ?? [], logs: b.logs?.deepLink });
      if (b.buildStatus !== "SUCCEEDED") process.exit(1);
      break;
    }
  }
}

// 4. Services.
async function findService(name) {
  let NextToken;
  do {
    const page = await apprunner.send(new ListServicesCommand({ NextToken }));
    const s = page.ServiceSummaryList?.find((x) => x.ServiceName === name);
    if (s) return (await apprunner.send(new DescribeServiceCommand({ ServiceArn: s.ServiceArn }))).Service;
    NextToken = page.NextToken;
  } while (NextToken);
  return undefined;
}

async function waitRunning(arn, name) {
  for (let i = 0; i < 90; i++) {
    const s = (await apprunner.send(new DescribeServiceCommand({ ServiceArn: arn }))).Service;
    if (s.Status === "RUNNING") {
      // An update keeps RUNNING while the new deployment rolls; the operation is what finishes.
      return s;
    }
    if (["CREATE_FAILED", "DELETED", "DELETE_FAILED"].includes(s.Status)) throw new Error(`${name} is ${s.Status}`);
    if (i % 3 === 0) log("waiting for service", { name, status: s.Status });
    await sleep(20_000);
  }
  throw new Error(`${name} did not reach RUNNING in 30 minutes`);
}

async function upsertService(name, env, healthPath, size) {
  const source = {
    ImageRepository: { ImageIdentifier: `${imageUri}:latest`, ImageRepositoryType: "ECR", ImageConfiguration: { Port: "8080", RuntimeEnvironmentVariables: env } },
    AuthenticationConfiguration: { AccessRoleArn: accessRole },
    AutoDeploymentsEnabled: false,
  };
  const instance = { Cpu: size.cpu, Memory: size.memory, InstanceRoleArn: instanceRole };
  const health = { Protocol: "HTTP", Path: healthPath, Interval: 10, Timeout: 5, HealthyThreshold: 1, UnhealthyThreshold: 5 };
  const existing = await findService(name);
  if (!existing) {
    for (let attempt = 0; ; attempt++) {
      try {
        const { Service } = await apprunner.send(new CreateServiceCommand({ ServiceName: name, SourceConfiguration: source, InstanceConfiguration: instance, HealthCheckConfiguration: health, Tags: [{ Key: "project", Value: NAME }] }));
        log("service creating", { name, url: `https://${Service.ServiceUrl}` });
        return waitRunning(Service.ServiceArn, name);
      } catch (e) {
        if (attempt < 5 && /role|assume/i.test(String(e?.message))) { await sleep(15_000); continue; }
        throw e;
      }
    }
  }
  await waitRunning(existing.ServiceArn, name);
  await apprunner.send(new UpdateServiceCommand({ ServiceArn: existing.ServiceArn, SourceConfiguration: source, InstanceConfiguration: instance, HealthCheckConfiguration: health }));
  log("service updating", { name });
  await sleep(30_000);
  return waitRunning(existing.ServiceArn, name);
}

const models = { AWS_REGION: region, BEDROCK_MODEL_FAST: cfg("BEDROCK_MODEL_FAST", "us.amazon.nova-2-lite-v1:0"), BEDROCK_MODEL_STRONG: cfg("BEDROCK_MODEL_STRONG", "us.anthropic.claude-sonnet-4-6"), BEDROCK_MODEL_STRONG_FALLBACK: cfg("BEDROCK_MODEL_STRONG_FALLBACK", "us.amazon.nova-pro-v1:0") };
const small = { cpu: "0.25 vCPU", memory: "1 GB" };

// The fixture Store first: the Bridge registers it at boot. Its own URL is only known after creation.
let fixture = await upsertService(`${NAME}-fixture-store`, { SERVICE: "fixture-store", FIXTURE_STORE_URL: "http://placeholder.invalid" }, "/.well-known/ucp", small);
const fixtureUrl = `https://${fixture.ServiceUrl}`;
if (fixture.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables?.FIXTURE_STORE_URL !== fixtureUrl) {
  fixture = await upsertService(`${NAME}-fixture-store`, { SERVICE: "fixture-store", FIXTURE_STORE_URL: fixtureUrl }, "/.well-known/ucp", small);
}

// The Bridge keeps its bearer across redeploys so the Simulator's copy stays valid.
const prior = await findService(`${NAME}-bridge`);
const bearer = prior?.SourceConfiguration?.ImageRepository?.ImageConfiguration?.RuntimeEnvironmentVariables?.BRIDGE_BEARER_TOKEN || randomBytes(32).toString("base64url");
const bridgeEnv = (base) => ({ SERVICE: "bridge", AGENTPOS_STORE_URL: fixtureUrl, BRIDGE_BASE_URL: base, BRIDGE_BEARER_TOKEN: bearer, AMAZON_PSP_MODE: "simulated", ...models });
let bridge = await upsertService(`${NAME}-bridge`, bridgeEnv(prior ? `https://${prior.ServiceUrl}` : "http://placeholder.invalid"), "/health", small);
const bridgeUrl = `https://${bridge.ServiceUrl}`;
if (bridge.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables?.BRIDGE_BASE_URL !== bridgeUrl) {
  bridge = await upsertService(`${NAME}-bridge`, bridgeEnv(bridgeUrl), "/health", small);
}

// Household memory: the existing AgentCore memory when there is one.
let memoryId = cfg("AGENTCORE_MEMORY_ID", "");
if (!memoryId) {
  const page = await new BedrockAgentCoreControlClient({ region }).send(new ListMemoriesCommand({ maxResults: 100 }));
  memoryId = page.memories?.find((m) => m.id?.startsWith("agentpos_alexa_household-") && m.status === "ACTIVE")?.id ?? "";
}
const simulator = await upsertService(
  `${NAME}-simulator`,
  { SERVICE: "simulator", BRIDGE_URL: bridgeUrl, BRIDGE_BEARER_TOKEN: bearer, SIMULATOR_BRAIN: "auto", SIMULATOR_MEMORY: "agentcore", ...(memoryId ? { AGENTCORE_MEMORY_ID: memoryId } : {}), ...models },
  "/api/health",
  small,
);

log("deployed", { simulator: `https://${simulator.ServiceUrl}/`, merchantConsole: `https://${simulator.ServiceUrl}/#/merchant`, bridge: bridgeUrl, fixtureStore: fixtureUrl, image: `${imageUri}:latest` });
