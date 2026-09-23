#!/usr/bin/env node
/**
 * Deploys the hosted playground (#20): builds infra/Dockerfile in CodeBuild from the public
 * GitHub repository, pushes it to ECR, and creates or updates three Amazon ECS Express Mode
 * services (fixture Store, Bridge, Simulator). Idempotent: every resource is found by name first.
 *
 *   node scripts/deploy-aws.mjs [--skip-build] [--ref main] [--only sim,bridge] [--tag <sha>]
 *
 * AWS access comes from the environment or .env (AWS_* only are read from it). Nothing
 * secret is printed; the Bridge bearer token lives only in the services' configuration.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CreateExpressGatewayServiceCommand, DescribeExpressGatewayServiceCommand, DescribeServicesCommand, ECSClient, UpdateExpressGatewayServiceCommand } from "@aws-sdk/client-ecs";
import { BatchGetBuildsCommand, BatchGetProjectsCommand, CodeBuildClient, CreateProjectCommand, StartBuildCommand, UpdateProjectCommand } from "@aws-sdk/client-codebuild";
import { CreateRepositoryCommand, DescribeRepositoriesCommand, ECRClient } from "@aws-sdk/client-ecr";
import { AttachRolePolicyCommand, CreateRoleCommand, GetRoleCommand, IAMClient, PutRolePolicyCommand } from "@aws-sdk/client-iam";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { mergeUsageCsv } from "./impact-export.mjs";
import { configuredDomains, syncDomainRules } from "./custom-domain.mjs";
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
const valueOf = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const ref = valueOf("--ref") ?? "main";
/** `--only sim,bridge` leaves the other services exactly as they are, on the image they run. */
const only = new Set((valueOf("--only") ?? "").split(",").map((x) => x.trim()).filter(Boolean));
/** `--tag <sha>` picks an image already in the registry, for a deploy that skips the build. */
const argTag = valueOf("--tag");
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
// Each service's public endpoint is generated at creation (FL-009), so services are created
// first and then updated with their own and their peers' real URLs.
const ecs = new ECSClient({ region });
const executionRole = await ensureRole(`${NAME}-ecs-execution`, "ecs-tasks.amazonaws.com", { managed: ["arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"] });
const infrastructureRole = await ensureRole(`${NAME}-ecs-infrastructure`, "ecs.amazonaws.com", { managed: ["arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices"] });
const taskRole = await ensureRole(`${NAME}-task`, "ecs-tasks.amazonaws.com", { inline: instancePolicy });

const serviceArnOf = (name) => `arn:aws:ecs:${region}:${account}:service/default/${name}`;
const PLACEHOLDER = "https://pending.invalid";

async function describe(name) {
  try {
    return (await ecs.send(new DescribeExpressGatewayServiceCommand({ serviceArn: serviceArnOf(name) }))).service;
  } catch (e) {
    if (["ServiceNotFoundException", "ResourceNotFoundException", "ClusterNotFoundException", "InvalidParameterException"].includes(e?.name) || /not found|does not exist/i.test(String(e?.message))) return undefined;
    throw e;
  }
}

/** The newest configuration's public endpoint, as an https URL. */
function endpointOf(service) {
  const configs = [...(service?.activeConfigurations ?? [])].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  for (const c of configs) {
    const p = c.ingressPaths?.find((i) => i.accessType === "PUBLIC") ?? c.ingressPaths?.[0];
    // The endpoint arrives with or without its scheme depending on the service; normalize it.
    if (p?.endpoint) return `https://${p.endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  }
  return undefined;
}

function envOf(service) {
  const configs = [...(service?.activeConfigurations ?? [])].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  return Object.fromEntries((configs[0]?.primaryContainer?.environment ?? []).map((e) => [e.name, e.value]));
}

/** Waits until one deployment is left, it completed, one task runs, and the endpoint answers. */
async function waitStable(name, path) {
  for (let i = 0; i < 120; i++) {
    const s = await describe(name);
    if (s?.status?.statusCode === "INACTIVE") throw new Error(`${name} is INACTIVE: ${s?.status?.statusReason ?? ""}`);
    const svc = (await ecs.send(new DescribeServicesCommand({ cluster: "default", services: [name] }))).services?.[0];
    const deployments = svc?.deployments ?? [];
    const settled = deployments.length === 1 && (deployments[0].rolloutState ?? "COMPLETED") === "COMPLETED" && svc.runningCount === 1;
    const url = endpointOf(s);
    let answered = false;
    if (settled && url) {
      try {
        answered = (await fetch(`${url}${path}`, { signal: AbortSignal.timeout(8000) })).ok;
      } catch {}
    }
    if (answered) return s;
    if (i % 4 === 0) log("waiting for service", { name, deployments: deployments.map((d) => `${d.status}:${d.rolloutState}`), running: svc?.runningCount ?? 0, url: url ?? null, lastEvent: svc?.events?.[0]?.message?.slice(0, 160) });
    await sleep(15_000);
  }
  throw new Error(`${name} did not become stable and healthy in 30 minutes`);
}

/** Upserts a service, or leaves it untouched when `--only` names the others. Returns its URL. */
async function serviceUrl(short, name, envFor, healthPath) {
  if (only.size === 0 || only.has(short)) return upsertService(name, envFor, healthPath);
  const url = endpointOf(await describe(name));
  if (!url) throw new Error(`${name} is not deployed yet, so --only cannot skip it`);
  log("service left as it is", { name, url });
  return url;
}

/** Creates or updates a service; env may be a function of the service's own URL. Returns its URL. */
async function upsertService(name, envFor, healthPath) {
  const build = (ownUrl) => {
    const env = envFor(ownUrl);
    return {
      executionRoleArn: executionRole,
      taskRoleArn: taskRole,
      healthCheckPath: healthPath,
      primaryContainer: { image: `${imageUri}:${tag}`, containerPort: 8080, environment: Object.entries(env).map(([k, v]) => ({ name: k, value: v })) },
      cpu: "256",
      memory: "1024",
      cpuArchitecture: "X86_64",
      scalingTarget: { minTaskCount: 1, maxTaskCount: 1 },
    };
  };
  let existing = await describe(name);
  if (!existing || existing.status?.statusCode === "INACTIVE") {
    for (let attempt = 0; ; attempt++) {
      try {
        await ecs.send(new CreateExpressGatewayServiceCommand({ serviceName: name, infrastructureRoleArn: infrastructureRole, ...build(PLACEHOLDER), tags: [{ key: "project", value: NAME }] }));
        break;
      } catch (e) {
        if (attempt < 6 && /assume|role/i.test(String(e?.message))) { await sleep(20_000); continue; }
        throw e;
      }
    }
    log("service creating", { name });
    for (let i = 0; i < 40 && !endpointOf(existing); i++) {
      await sleep(15_000);
      existing = await describe(name);
    }
  }
  const url = endpointOf(existing);
  if (!url) throw new Error(`${name} has no public endpoint`);
  const wanted = build(url);
  const current = envOf(existing);
  const wantedEnv = Object.fromEntries(wanted.primaryContainer.environment.map((e) => [e.name, e.value]));
  const currentImage = [...(existing.activeConfigurations ?? [])].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))[0]?.primaryContainer?.image;
  const same = currentImage === wanted.primaryContainer.image && Object.keys(wantedEnv).length === Object.keys(current).length && Object.entries(wantedEnv).every(([k, v]) => current[k] === v);
  if (!same) {
    await waitStable(name, healthPath).catch(() => undefined); // an update is refused while a deployment is in flight
    await ecs.send(new UpdateExpressGatewayServiceCommand({ serviceArn: existing.serviceArn, ...wanted }));
    log("service updating", { name, url, image: wanted.primaryContainer.image });
    await sleep(30_000);
  }
  await waitStable(name, healthPath);
  log("service ready", { name, url });
  return url;
}

const tag = builtTag ?? argTag ?? "latest";
const models = { AWS_REGION: region, BEDROCK_MODEL_FAST: cfg("BEDROCK_MODEL_FAST", "us.amazon.nova-2-lite-v1:0"), BEDROCK_MODEL_STRONG: cfg("BEDROCK_MODEL_STRONG", "us.anthropic.claude-sonnet-4-6"), BEDROCK_MODEL_STRONG_FALLBACK: cfg("BEDROCK_MODEL_STRONG_FALLBACK", "us.amazon.nova-pro-v1:0") };
const storeName = `${NAME}-store`;
const bridgeName = `${NAME}-bridge`;
const simulatorName = `${NAME}-sim`;

// The bearer survives redeploys: it is read back from the running Bridge's configuration.
const bearer = envOf(await describe(bridgeName)).BRIDGE_BEARER_TOKEN || randomBytes(32).toString("base64url");

let memoryId = cfg("AGENTCORE_MEMORY_ID", "");
if (!memoryId) {
  const page = await new BedrockAgentCoreControlClient({ region }).send(new ListMemoriesCommand({ maxResults: 100 }));
  memoryId = page.memories?.find((m) => m.id?.startsWith("agentpos_alexa_household-") && m.status === "ACTIVE")?.id ?? "";
}

// The fixture Store's own Stripe account in test mode, when configured locally: only the Store receives it.
const stripeEnv = fileEnv.FIXTURE_STRIPE_SECRET_KEY?.startsWith("sk_test_") ? { FIXTURE_STRIPE_SECRET_KEY: fileEnv.FIXTURE_STRIPE_SECRET_KEY, FIXTURE_STRIPE_PUBLISHABLE_KEY: fileEnv.FIXTURE_STRIPE_PUBLISHABLE_KEY || fileEnv.STRIPE_PUBLISHABLE_KEY || "" } : {};
// The two testnet keys the x402 rail needs: the Store's, which receives and submits the
// transfer, and the demo household's, which signs it. Testnet seeds for a demo household and
// a fixture Store, deployed the same way as the Stripe test key; no mainnet key belongs here.
const seed = (value) => (/^S[A-Z2-7]{55}$/.test(value ?? "") ? value : "");
const storeStellar = seed(fileEnv.FIXTURE_STELLAR_SECRET) ? { FIXTURE_STELLAR_SECRET: fileEnv.FIXTURE_STELLAR_SECRET } : {};
const householdStellar = seed(fileEnv.DEMO_HOUSEHOLD_STELLAR_SECRET) ? { DEMO_HOUSEHOLD_STELLAR_SECRET: fileEnv.DEMO_HOUSEHOLD_STELLAR_SECRET } : {};
log("x402 rail configuration", { store: Boolean(storeStellar.FIXTURE_STELLAR_SECRET), household: Boolean(householdStellar.DEMO_HOUSEHOLD_STELLAR_SECRET), hint: "node scripts/stellar-testnet.mjs" });
const storeUrl = await serviceUrl("store", storeName, (own) => ({ SERVICE: "fixture-store", FIXTURE_STORE_URL: own, ...stripeEnv, ...storeStellar }), "/.well-known/ucp");
// PUBLIC_BRIDGE_URL is the name the Bridge publishes in profiles and checkout links (a
// subdomain in front of the load balancer); its own endpoint is what the Simulator calls.
const publicBridgeUrl = cfg("PUBLIC_BRIDGE_URL", "");
// The Bridge's usage_events live on its task's disk, which the redeploy replaces: pull them
// out first and merge them into the committed impact file, so the measured history of the
// playground survives every release.
const priorBridge = await describe(bridgeName);
if (priorBridge && endpointOf(priorBridge)) {
  try {
    const res = await fetch(`${endpointOf(priorBridge)}/admin/usage-events.csv`, { headers: { Authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(20_000) });
    if (res.ok) {
      const { added, total, path } = mergeUsageCsv(await res.text(), root);
      log("usage events exported before redeploy", { added, total, file: path, closedSessions: Number(res.headers.get("X-Closed-Sessions") ?? 0) });
    } else log("usage events export skipped", { status: res.status });
  } catch (e) {
    log("usage events export failed", { error: String(e).slice(0, 200) });
  }
}

const bridgeUrl = await serviceUrl("bridge", bridgeName, (own) => ({ SERVICE: "bridge", AGENTPOS_STORE_URL: storeUrl, BRIDGE_BASE_URL: publicBridgeUrl || own, BRIDGE_BEARER_TOKEN: bearer, AMAZON_PSP_MODE: "simulated", ...models }), "/health");
// The waitlist lives on the Simulator task's disk: export it before a redeploy replaces the task.
const priorSim = await describe(simulatorName);
const adminToken = envOf(priorSim).SIMULATOR_ADMIN_TOKEN || randomBytes(32).toString("base64url");
if (priorSim && envOf(priorSim).SIMULATOR_ADMIN_TOKEN && endpointOf(priorSim)) {
  try {
    const res = await fetch(`${endpointOf(priorSim)}/api/waitlist/export`, { headers: { Authorization: `Bearer ${adminToken}` }, signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      const csv = await res.text();
      const dir = resolve(root, ".data", "waitlist-exports");
      mkdirSync(dir, { recursive: true });
      const file = resolve(dir, `waitlist-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`);
      writeFileSync(file, csv);
      log("waitlist exported before redeploy", { rows: Math.max(0, csv.trim().split(/\r?\n/).length - 1), file });
    } else log("waitlist export skipped", { status: res.status });
  } catch (e) {
    log("waitlist export failed", { error: String(e).slice(0, 200) });
  }
  // The Household agent's rows live on the same disk, and belong in the committed history.
  try {
    const res = await fetch(`${endpointOf(priorSim)}/api/usage-events.csv`, { headers: { Authorization: `Bearer ${adminToken}` }, signal: AbortSignal.timeout(20_000) });
    // The running Simulator may predate the route, and a single page app answers its own HTML.
    if (res.ok && (res.headers.get("content-type") ?? "").includes("csv")) {
      const { added, total, path } = mergeUsageCsv(await res.text(), root);
      log("simulator usage events exported before redeploy", { added, total, file: path });
    } else log("simulator usage events export skipped", { status: res.status, contentType: res.headers.get("content-type") ?? null });
  } catch (e) {
    log("simulator usage events export failed", { error: String(e).slice(0, 200) });
  }
}

const simulatorUrl = await serviceUrl("sim", simulatorName, () => ({ SERVICE: "simulator", BRIDGE_URL: bridgeUrl, BRIDGE_BEARER_TOKEN: bearer, SIMULATOR_BRAIN: "auto", SIMULATOR_MEMORY: "agentcore", SIMULATOR_ADMIN_TOKEN: adminToken, ...(memoryId ? { AGENTCORE_MEMORY_ID: memoryId } : {}), ...householdStellar, ...models }), "/api/health");

// Express Mode flips the forward weights between a service's two target groups on every
// deployment and updates only the generated name's rule, so the project's own names have to
// follow or they answer 503 as soon as the old tasks drain (FL-012). The flip can land while
// the old tasks are still draining, so this repeats until every name answers.
const domains = configuredDomains();
for (let attempt = 1; attempt <= 4 && domains.length > 0; attempt++) {
  try {
    for (const change of await syncDomainRules(domains)) log(change.msg, change);
  } catch (e) {
    log("domain names not re-pointed", { error: String(e).slice(0, 200), hint: "node scripts/custom-domain.mjs --sync" });
    break;
  }
  // A 4xx is the service answering; only a 5xx or no answer means the name is still dark.
  const dark = [];
  for (const { domain } of domains) {
    const answered = await fetch(`https://${domain}/`, { redirect: "manual", signal: AbortSignal.timeout(15_000) })
      .then((r) => r.status < 500)
      .catch(() => false);
    if (!answered) dark.push(domain);
  }
  if (dark.length === 0) {
    log("names answering", { domains: domains.map((d) => d.domain) });
    break;
  }
  log("names not answering yet", { domains: dark, attempt });
  if (attempt < 4) await sleep(30_000);
}

log("deployed", { simulator: `${simulatorUrl}/`, merchantConsole: `${simulatorUrl}/#/merchant`, bridge: bridgeUrl, fixtureStore: storeUrl, image: `${imageUri}:${tag}` });
