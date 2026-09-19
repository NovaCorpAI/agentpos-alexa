#!/usr/bin/env node
/**
 * Puts the project's own domain names in front of the ECS Express Mode services, without a
 * proxy in the middle: one ACM certificate, added to the load balancer's HTTPS listener, and
 * one host header rule per name pointing at the same target group the generated name uses.
 *
 *   node scripts/custom-domain.mjs alexa.agentposhq.com=<service> bridge.agentposhq.com=<service>
 *
 * Idempotent, and it never touches DNS: it prints the records to create (validation first,
 * then the CNAME to the load balancer) and waits for the certificate to be issued.
 */
import { ACMClient, DescribeCertificateCommand, ListCertificatesCommand, RequestCertificateCommand } from "@aws-sdk/client-acm";
import {
  AddListenerCertificatesCommand,
  CreateRuleCommand,
  DescribeListenersCommand,
  DescribeLoadBalancersCommand,
  DescribeRulesCommand,
  ElasticLoadBalancingV2Client,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import { DescribeExpressGatewayServiceCommand, ECSClient } from "@aws-sdk/client-ecs";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const envFile = resolve(root, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^(AWS_[A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
void dirname;

const region = process.env.AWS_REGION || "us-east-1";
const pairs = process.argv.slice(2).filter((a) => a.includes("="));
if (pairs.length === 0) {
  console.log("usage: node scripts/custom-domain.mjs alexa.agentposhq.com=agentpos-alexa-sim bridge.agentposhq.com=agentpos-alexa-bridge");
  process.exit(64);
}
const wanted = pairs.map((p) => ({ domain: p.slice(0, p.indexOf("=")).toLowerCase(), service: p.slice(p.indexOf("=") + 1) }));

const log = (msg, extra = {}) => console.log(JSON.stringify({ msg, ...extra }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const acm = new ACMClient({ region });
const elb = new ElasticLoadBalancingV2Client({ region });
const ecs = new ECSClient({ region });
const account = (await new STSClient({ region }).send(new GetCallerIdentityCommand({}))).Account;

/** The generated host name of each service, which already has a rule on the listener. */
async function generatedHost(service) {
  const s = (await ecs.send(new DescribeExpressGatewayServiceCommand({ serviceArn: `arn:aws:ecs:${region}:${account}:service/default/${service}` }))).service;
  const configs = [...(s.activeConfigurations ?? [])].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  for (const c of configs) {
    const p = c.ingressPaths?.find((i) => i.accessType === "PUBLIC") ?? c.ingressPaths?.[0];
    if (p?.endpoint) return p.endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }
  throw new Error(`${service} has no public endpoint`);
}

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
      Tags: [{ Key: "project", Value: "agentpos-alexa" }],
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
const { LoadBalancers = [] } = await elb.send(new DescribeLoadBalancersCommand({}));
const alb = LoadBalancers.find((l) => l.LoadBalancerName?.startsWith("ecs-express-gateway"));
if (!alb) throw new Error("no Express Mode load balancer found");
const { Listeners = [] } = await elb.send(new DescribeListenersCommand({ LoadBalancerArn: alb.LoadBalancerArn }));
const https = Listeners.find((l) => l.Protocol === "HTTPS");
if (!https) throw new Error("the load balancer has no HTTPS listener");
await elb.send(new AddListenerCertificatesCommand({ ListenerArn: https.ListenerArn, Certificates: [{ CertificateArn: certificateArn }] }));
log("certificate on the listener", { listener: https.ListenerArn.split("/").pop() });

const { Rules = [] } = await elb.send(new DescribeRulesCommand({ ListenerArn: https.ListenerArn }));
const used = new Set(Rules.map((r) => Number(r.Priority)).filter(Number.isFinite));
let priority = 100;
const nextPriority = () => {
  while (used.has(priority)) priority++;
  used.add(priority);
  return priority;
};

for (const { domain, service } of wanted) {
  const host = await generatedHost(service);
  const existing = Rules.find((r) => (r.Conditions ?? []).some((c) => (c.HostHeaderConfig?.Values ?? c.Values ?? []).includes(domain)));
  if (existing) {
    log("rule already there", { domain, priority: existing.Priority });
    continue;
  }
  const base = Rules.find((r) => (r.Conditions ?? []).some((c) => (c.HostHeaderConfig?.Values ?? c.Values ?? []).includes(host)));
  if (!base) throw new Error(`no rule found for ${host}; is ${service} deployed?`);
  await elb.send(
    new CreateRuleCommand({
      ListenerArn: https.ListenerArn,
      Priority: nextPriority(),
      Conditions: [{ Field: "host-header", HostHeaderConfig: { Values: [domain] } }],
      Actions: base.Actions,
      Tags: [{ Key: "project", Value: "agentpos-alexa" }],
    }),
  );
  log("rule created", { domain, service, forwardsWith: host });
}

console.log("\nLast DNS step, in Cloudflare (DNS only, grey cloud):\n");
for (const { domain } of wanted) console.log(`  ${domain}  CNAME  ${alb.DNSName}`);
console.log("\nThen the names answer over HTTPS with no proxy in the middle.\n");
