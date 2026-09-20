#!/usr/bin/env node
/**
 * Puts the project's own domain names in front of the ECS Express Mode services, without a
 * proxy in the middle: one ACM certificate, added to the load balancer's HTTPS listener, and
 * one host header rule per name pointing at the same target group the generated name uses.
 *
 *   node scripts/custom-domain.mjs alexa.agentposhq.com=<service> bridge.agentposhq.com=<service>
 *   node scripts/custom-domain.mjs --sync      re-point the names in infra/domains.json
 *
 * Idempotent, and it never touches DNS: it prints the records to create (validation first,
 * then the CNAME to the load balancer) and waits for the certificate to be issued.
 *
 * Express Mode gives a service a new target group on every deployment (FL-012), so the names
 * have to follow it. `pnpm deploy:aws` imports syncDomainRules and calls it after a release.
 */
import { ACMClient, DescribeCertificateCommand, ListCertificatesCommand, RequestCertificateCommand } from "@aws-sdk/client-acm";
import {
  AddListenerCertificatesCommand,
  CreateRuleCommand,
  DescribeListenersCommand,
  DescribeLoadBalancersCommand,
  DescribeRulesCommand,
  ElasticLoadBalancingV2Client,
  ModifyRuleCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import { DescribeExpressGatewayServiceCommand, ECSClient } from "@aws-sdk/client-ecs";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const envFile = resolve(root, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^(AWS_[A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const region = process.env.AWS_REGION || "us-east-1";
const log = (msg, extra = {}) => console.log(JSON.stringify({ msg, ...extra }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const acm = new ACMClient({ region });
const elb = new ElasticLoadBalancingV2Client({ region });
const ecs = new ECSClient({ region });
let accountId = "";
const account = async () => (accountId ||= (await new STSClient({ region }).send(new GetCallerIdentityCommand({}))).Account);

/** The names this project serves, and the service behind each: the file `--sync` reads. */
export function configuredDomains() {
  const file = resolve(root, "infra/domains.json");
  if (!existsSync(file)) return [];
  return Object.entries(JSON.parse(readFileSync(file, "utf8"))).map(([domain, service]) => ({ domain: domain.toLowerCase(), service }));
}

/** The generated host name of a service, which already has a rule on the listener. */
async function generatedHost(service) {
  const s = (await ecs.send(new DescribeExpressGatewayServiceCommand({ serviceArn: `arn:aws:ecs:${region}:${await account()}:service/default/${service}` }))).service;
  const configs = [...(s.activeConfigurations ?? [])].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  for (const c of configs) {
    const p = c.ingressPaths?.find((i) => i.accessType === "PUBLIC") ?? c.ingressPaths?.[0];
    if (p?.endpoint) return p.endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }
  throw new Error(`${service} has no public endpoint`);
}

/** The project's HTTPS listener on the Express Mode load balancer, and the balancer itself. */
export async function httpsListener() {
  const { LoadBalancers = [] } = await elb.send(new DescribeLoadBalancersCommand({}));
  const alb = LoadBalancers.find((l) => l.LoadBalancerName?.startsWith("ecs-express-gateway"));
  if (!alb) throw new Error("no Express Mode load balancer found");
  const { Listeners = [] } = await elb.send(new DescribeListenersCommand({ LoadBalancerArn: alb.LoadBalancerArn }));
  const listener = Listeners.find((l) => l.Protocol === "HTTPS");
  if (!listener) throw new Error("the load balancer has no HTTPS listener");
  return { alb, listenerArn: listener.ListenerArn };
}

/**
 * Points each name at whatever the service's generated host points at right now, creating
 * the rule the first time and moving it afterwards. A name whose rule is left behind answers
 * 503 as soon as the deployment that created its target group drains.
 */
export async function syncDomainRules(pairs, listenerArn) {
  if (pairs.length === 0) return [];
  const arn = listenerArn ?? (await httpsListener()).listenerArn;
  const { Rules = [] } = await elb.send(new DescribeRulesCommand({ ListenerArn: arn }));
  const used = new Set(Rules.map((r) => Number(r.Priority)).filter(Number.isFinite));
  let priority = 100;
  const nextPriority = () => {
    while (used.has(priority)) priority++;
    used.add(priority);
    return priority;
  };
  const hostsOf = (rule) => (rule.Conditions ?? []).flatMap((c) => c.HostHeaderConfig?.Values ?? c.Values ?? []);
  const targetOf = (actions = []) => actions.map((a) => a.TargetGroupArn ?? "").join(",");
  const shortTarget = (actions) => targetOf(actions).split("/").at(-2) ?? "";

  const changes = [];
  for (const { domain, service } of pairs) {
    const host = await generatedHost(service);
    const base = Rules.find((r) => hostsOf(r).includes(host));
    if (!base) throw new Error(`no rule found for ${host}; is ${service} deployed?`);
    const existing = Rules.find((r) => hostsOf(r).includes(domain));
    if (!existing) {
      await elb.send(
        new CreateRuleCommand({
          ListenerArn: arn,
          Priority: nextPriority(),
          Conditions: [{ Field: "host-header", HostHeaderConfig: { Values: [domain] } }],
          Actions: base.Actions,
        }),
      );
      changes.push({ msg: "rule created", domain, service, forwardsWith: host });
      continue;
    }
    if (targetOf(existing.Actions) === targetOf(base.Actions)) {
      changes.push({ msg: "name already points at the live tasks", domain, service });
      continue;
    }
    await elb.send(new ModifyRuleCommand({ RuleArn: existing.RuleArn, Actions: base.Actions }));
    changes.push({ msg: "name re-pointed after the redeploy", domain, service, from: shortTarget(existing.Actions), to: shortTarget(base.Actions) });
  }
  return changes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const pairs = args.filter((a) => a.includes("="));
  const wanted = args.includes("--sync") && pairs.length === 0 ? configuredDomains() : pairs.map((p) => ({ domain: p.slice(0, p.indexOf("=")).toLowerCase(), service: p.slice(p.indexOf("=") + 1) }));
  if (wanted.length === 0) {
    console.log("usage: node scripts/custom-domain.mjs alexa.agentposhq.com=agentpos-alexa-sim bridge.agentposhq.com=agentpos-alexa-bridge");
    console.log("       node scripts/custom-domain.mjs --sync   re-point the names in infra/domains.json");
    process.exit(64);
  }

  const { alb, listenerArn } = await httpsListener();

  if (args.includes("--sync")) {
    for (const change of await syncDomainRules(wanted, listenerArn)) log(change.msg, change);
  } else {
    // 1. One certificate for every name.
    const domains = wanted.map((w) => w.domain);
    const { CertificateSummaryList = [] } = await acm.send(new ListCertificatesCommand({ MaxItems: 100 }));
    let certificateArn = CertificateSummaryList.find((c) => domains.every((d) => c.DomainName === d || (c.SubjectAlternativeNameSummaries ?? []).includes(d)))?.CertificateArn;
    if (!certificateArn) {
      const res = await acm.send(
        new RequestCertificateCommand({
          DomainName: domains[0],
          ...(domains.length > 1 ? { SubjectAlternativeNames: domains.slice(1) } : {}),
          ValidationMethod: "DNS",
        }),
      );
      certificateArn = res.CertificateArn;
      log("certificate requested", { certificateArn, domains });
      await sleep(5000);
    }

    // 2. Wait for the records to appear, print them, and wait for the certificate to be issued.
    let certificate;
    for (let i = 0; i < 120; i++) {
      certificate = (await acm.send(new DescribeCertificateCommand({ CertificateArn: certificateArn }))).Certificate;
      const options = certificate.DomainValidationOptions ?? [];
      const pending = options.filter((o) => o.ValidationStatus !== "SUCCESS");
      if (certificate.Status === "ISSUED") break;
      if (certificate.Status === "FAILED" || certificate.Status === "VALIDATION_TIMED_OUT") throw new Error(`certificate ${certificate.Status}`);
      if (i === 0 || i % 6 === 0) {
        console.log("\nAdd these CNAME records in Cloudflare (DNS only, grey cloud), then leave this running:\n");
        for (const o of options) {
          if (!o.ResourceRecord) continue;
          console.log(`  ${o.DomainName}\n    name:  ${o.ResourceRecord.Name}\n    value: ${o.ResourceRecord.Value}\n    status: ${o.ValidationStatus}`);
        }
        console.log(`\nwaiting for ${pending.length} name(s) to validate...\n`);
      }
      await sleep(15_000);
    }
    if (certificate.Status !== "ISSUED") throw new Error("certificate was not issued in 30 minutes");
    log("certificate issued", { certificateArn });

    // 3. Teach the load balancer the names: the certificate, then a rule each.
    await elb.send(new AddListenerCertificatesCommand({ ListenerArn: listenerArn, Certificates: [{ CertificateArn: certificateArn }] }));
    log("certificate on the listener", { listener: listenerArn.split("/").pop() });

    for (const change of await syncDomainRules(wanted, listenerArn)) log(change.msg, change);

    console.log("\nLast DNS step, in Cloudflare (DNS only, grey cloud):\n");
    for (const { domain } of wanted) console.log(`  ${domain}  CNAME  ${alb.DNSName}`);
    console.log("\nThen the names answer over HTTPS with no proxy in the middle.\n");
  }
}
