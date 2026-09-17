#!/usr/bin/env node
/**
 * Deploys the hosted playground (#20): builds infra/Dockerfile in CodeBuild from the public
 * GitHub repository, pushes it to ECR, and creates or updates three Amazon ECS Express Mode
 * services (fixture Store, Bridge, Simulator). Idempotent: every resource is found by name first.
 *
 *   node scripts/deploy-aws.mjs [--skip-build] [--ref main]
 *
 * AWS access comes from the environment or .env (AWS_* only are read from it). Nothing
 * secret is printed; the Bridge bearer token lives only in the services' configuration.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { CreateExpressGatewayServiceCommand, DescribeExpressGatewayServiceCommand, ECSClient, UpdateExpressGatewayServiceCommand } from "@aws-sdk/client-ecs";
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

// 2. Roles: the image build, and the services' own AWS access (models, voice, memory).
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
const instancePolicy = {
    Version: "2012-10-17",
    Statement: [
      { Effect: "Allow", Action: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock:Converse", "bedrock:ConverseStream"], Resource: "*" },
      { Effect: "Allow", Action: ["polly:SynthesizeSpeech", "polly:DescribeVoices"], Resource: "*" },
      { Effect: "Allow", Action: ["bedrock-agentcore:CreateEvent", "bedrock-agentcore:ListEvents", "bedrock-agentcore:GetMemory", "bedrock-agentcore:ListMemories"], Resource: "*" },
    ],
};

// 3. Image, built in CodeBuild from the public repository and tagged with the commit.
let builtTag;
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
      builtTag = b.resolvedSourceVersion;
      break;
    }
  }
}

// 4. Services on Amazon ECS Express Mode (App Runner is closed to new customers, FL-008).
// Express Mode URLs are https://<service-name>.ecs.<region>.on.aws, known before creation,
// so every service is created with its peers' addresses already set.
const ecs = new ECSClient({ region });
const executionRole = await ensureRole(`${NAME}-ecs-execution`, "ecs-tasks.amazonaws.com", { managed: ["arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"] });
const infrastructureRole = await ensureRole(`${NAME}-ecs-infrastructure`, "ecs.amazonaws.com", { managed: ["arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices"] });
const taskRole = await ensureRole(`${NAME}-task`, "ecs-tasks.amazonaws.com", { inline: instancePolicy });

const urlOf = (name) => `https://${name}.ecs.${region}.on.aws`;
const serviceArnOf = (name) => `arn:aws:ecs:${region}:${account}:service/default/${name}`;
const tag = builtTag ?? "latest";

async function describe(name) {
  try {
    return (await ecs.send(new DescribeExpressGatewayServiceCommand({ serviceArn: serviceArnOf(name) }))).service;
  } catch (e) {
    if (["ServiceNotFoundException", "ResourceNotFoundException", "ClusterNotFoundException"].includes(e?.name) || /not found|does not exist/i.test(String(e?.message))) return undefined;
    throw e;
  }
}

async function waitHealthy(name, path) {
  const url = `${urlOf(name)}${path}`;
  for (let i = 0; i < 120; i++) {
    const s = await describe(name);
    const code = s?.status?.statusCode;
    if (code === "INACTIVE") throw new Error(`${name} is INACTIVE: ${s?.status?.statusReason ?? ""}`);
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (r.ok && code === "ACTIVE") return s;
    } catch {}
    if (i % 4 === 0) log("waiting for service", { name, status: code ?? "unknown", url });
    await sleep(15_000);
  }
  throw new Error(`${name} did not answer ${url} in 30 minutes`);
}

async function upsertService(name, env, healthPath) {
  const container = { image: `${imageUri}:${tag}`, containerPort: 8080, environment: Object.entries(env).map(([k, v]) => ({ name: k, value: v })) };
  const common = { executionRoleArn: executionRole, taskRoleArn: taskRole, healthCheckPath: healthPath, primaryContainer: container, cpu: "256", memory: "1024", cpuArchitecture: "X86_64", scalingTarget: { minTaskCount: 1, maxTaskCount: 1 } };
  const existing = await describe(name);
  if (existing && existing.status?.statusCode !== "INACTIVE") {
    await ecs.send(new UpdateExpressGatewayServiceCommand({ serviceArn: existing.serviceArn, ...common }));
    log("service updating", { name, image: container.image });
  } else {
    for (let attempt = 0; ; attempt++) {
      try {
        await ecs.send(new CreateExpressGatewayServiceCommand({ serviceName: name, infrastructureRoleArn: infrastructureRole, ...common, tags: [{ key: "project", value: NAME }] }));
        break;
      } catch (e) {
        if (attempt < 6 && /assume|role/i.test(String(e?.message))) { await sleep(20_000); continue; }
        throw e;
      }
    }
    log("service creating", { name, url: urlOf(name) });
  }
  // One task on purpose: each service keeps its SQLite state on the task's disk.
  return waitHealthy(name, healthPath);
}

const models = { AWS_REGION: region, BEDROCK_MODEL_FAST: cfg("BEDROCK_MODEL_FAST", "us.amazon.nova-2-lite-v1:0"), BEDROCK_MODEL_STRONG: cfg("BEDROCK_MODEL_STRONG", "us.anthropic.claude-sonnet-4-6"), BEDROCK_MODEL_STRONG_FALLBACK: cfg("BEDROCK_MODEL_STRONG_FALLBACK", "us.amazon.nova-pro-v1:0") };
const fixtureName = `${NAME}-store`;
const bridgeName = `${NAME}-bridge`;
const simulatorName = `${NAME}-sim`;

// The bearer survives redeploys: it is read back from the running Bridge's configuration.
const priorBridge = await describe(bridgeName);
const priorEnv = priorBridge?.activeConfigurations?.[0]?.primaryContainer?.environment ?? [];
const bearer = priorEnv.find((e) => e.name === "BRIDGE_BEARER_TOKEN")?.value || randomBytes(32).toString("base64url");

let memoryId = cfg("AGENTCORE_MEMORY_ID", "");
if (!memoryId) {
  const page = await new BedrockAgentCoreControlClient({ region }).send(new ListMemoriesCommand({ maxResults: 100 }));
  memoryId = page.memories?.find((m) => m.id?.startsWith("agentpos_alexa_household-") && m.status === "ACTIVE")?.id ?? "";
}

// The fixture Store first (the Bridge registers it at boot), then the Bridge and the Simulator together.
await upsertService(fixtureName, { SERVICE: "fixture-store", FIXTURE_STORE_URL: urlOf(fixtureName) }, "/.well-known/ucp");
await Promise.all([
  upsertService(bridgeName, { SERVICE: "bridge", AGENTPOS_STORE_URL: urlOf(fixtureName), BRIDGE_BASE_URL: urlOf(bridgeName), BRIDGE_BEARER_TOKEN: bearer, AMAZON_PSP_MODE: "simulated", ...models }, "/health"),
  upsertService(simulatorName, { SERVICE: "simulator", BRIDGE_URL: urlOf(bridgeName), BRIDGE_BEARER_TOKEN: bearer, SIMULATOR_BRAIN: "auto", SIMULATOR_MEMORY: "agentcore", ...(memoryId ? { AGENTCORE_MEMORY_ID: memoryId } : {}), ...models }, "/api/health"),
]);

log("deployed", { simulator: `${urlOf(simulatorName)}/`, merchantConsole: `${urlOf(simulatorName)}/#/merchant`, bridge: urlOf(bridgeName), fixtureStore: urlOf(fixtureName), image: `${imageUri}:${tag}` });
