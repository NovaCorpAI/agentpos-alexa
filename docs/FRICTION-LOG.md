# Friction log

Written while building, one entry per obstacle with an Amazon or AWS SDK, API, simulator,
console or document. Severity: Blocking (could not proceed), High (hours lost), Medium
(confusion, quick workaround), Low (detail).

Each entry: date, tool, the task attempted, the steps taken, what we expected, what actually
happened (exact error, observed behaviour, doc link), severity, time lost, the workaround, a
concrete suggestion for the Amazon team, and a link to the commit or file. The tools that gave us no trouble are at the end, so the feedback covers
everything we used, not only what hurt.

---

## FL-001

- Date: 2026-09-14
- Tool: Alexa+ MCP Toolkit and Alexa+ for Builders
- What we tried: enroll to register a self-hosted MCP add-on from a company account in Chile.
- Expected: a self-serve path to a sandbox, or a documented way in from outside the United States.
- Actual: the MCP Toolkit overview states "The MCP Toolkit is available in the United
  States" and Alexa+ for Builders is "currently available to select partners working directly
  with our team". No self-serve path found.
- Severity: High (changes the demo strategy)
- Time lost: about 2 h of reading and enrollment attempts (estimate, confirm)
- Workaround: the track rules accept "a simulated Alexa+ experience in a web app using your
  preferred agentic tool"; we build `apps/simulator` with Bedrock and Strands and target the
  same MCP and checkout contracts.
- Suggestion: a sandbox-only enrollment for developers outside the US, gated to the
  simulator, would let global developers validate add-ons before the program opens.
- Link: commit 72e72e5, apps/simulator

## FL-002

- Date: 2026-09-15
- Tool: Alexa AI CLI (`@alexa-ai/cli`), Local Inspector (`@alexa-ai/addon-local-inspector`),
  web simulator in the developer console.
- What we tried: install the CLI and the Local Inspector to validate an MCP add-on locally
  without being in the partner program. The set-up page documents
  `npm install -g @alexa-ai/cli`, and the Local Inspector page promises to "connect to your MCP
  server, call its tools, and instantly see how the resulting UI widgets render inside Alexa
  device frames, before you submit anything for review".
- Expected: `npm install -g @alexa-ai/cli` and the Local Inspector to install from the public registry, as the set-up page shows.
- Actual: both packages must be pulled from a private AWS CodeArtifact registry
  (`aws codeartifact login ... --domain alexa-ai --domain-owner 372468808636`) with a role
  obtained from an Alexa Solutions Architect. `npm view @alexa-ai/cli` and
  `npm view @alexa-ai/addon-local-inspector` return E404 on the public registry. The web
  simulator needs a deployed add-on, so it needs the same access. No official GitHub
  repository for either tool.
  Docs: https://developer.amazon.com/docs/alexaplus/add-ons/set-up-your-development-environment.html,
  https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-local-inspector.html,
  https://developer.amazon.com/docs/alexaplus/add-ons/test-with-web-simulator.html
- Severity: High (no way to validate rendering or certification verdicts with Amazon's tool)
- Time lost: about 1 h of research
- Workaround: `apps/simulator` renders the documented components (list, carousel, card) in
  Echo Show frames following the published design guide and display modes, and reports its
  own `inspection-summary.json` with the same fields the Local Inspector documents.
- Suggestion: publish `@alexa-ai/addon-local-inspector` on the public npm registry. It runs
  against the developer's own MCP server and needs no Amazon backend, so gating it only
  removes the cheapest quality check from everyone building the simulated path the hackathon
  itself recommends.
- Link: docs/STRATEGY.md, apps/simulator

## FL-003

- Date: 2026-09-15
- Tool: Alexa+ checkout integration, `com.amazon.payments.network_token` handler.
- What we tried: find test vectors, a sample encrypted token, the key exchange procedure or a
  sandbox issuer for the network token handler, so the `complete` path can be exercised end to
  end without program access. Also checked whether the merchant's PSP (Stripe) can accept a
  third-party network token plus cryptogram directly.
- Expected: a sandbox issuer, a sample encrypted payload or test vectors, so the handler can be exercised end to end.
- Actual: the checkout doc states "You receive an encrypted token only you can decrypt"
  but publishes no key format, sample payload or sandbox. Stripe's public API exposes no
  parameter for a third-party network token (only `card.number`, the legacy `token`, and the
  3D Secure import fields for CAVV cryptograms); its Vault and Forward product is outbound only
  and gated. Docs: https://developer.amazon.com/docs/alexaplus/add-ons/checkout-integration.html,
  https://docs.stripe.com/api/payment_methods/create,
  https://docs.stripe.com/payments/vault-and-forward
- Severity: Medium (changes how the Amazon handler is demonstrated, not whether)
- Time lost: about 1 h of research
- Workaround: the Amazon handlers run against a simulated PSP and are labeled as such
  everywhere (hard rule 9). The real fiat rail is the UCP `dev.ucp.processor_tokenizer` handler
  with Stripe test mode as processor: the client tokenizes with Stripe, the store charges. The
  two are never blurred in code, logs or UI.
- Suggestion: publish a sandbox for the network token handler with a sample encrypted payload,
  the decryption procedure and the PSP integration pattern Amazon expects (which PSPs accept
  the decrypted token, in which API). Without it, every entrant outside the program ships a
  different simulation of the same step.
- Link: packages/bridge/src/versions.ts, docs/STRATEGY.md

## FL-004

- Date: 2026-09-16
- Tool: Strands Agents SDK for TypeScript (`@strands-agents/sdk` 1.17), MCP client (`McpClient`).
- What we tried: give the Household agent the Bridge's MCP tools through the SDK's own
  `McpClient`, so that the agent and the host (the simulator) share one connection and one
  tool list.
- Expected: the SDK's MCP client to hand us the whole tool result, `structuredContent` and `_meta` included.
- Actual: `McpTool.stream` maps only `result.content` (text, image, embedded resource)
  and `isError`; the `structuredContent` block and the result `_meta` are accepted and
  dropped. MCP Apps depends on `_meta.ui.resourceUri` on the tool definition and on the host
  forwarding the full result to the view, and our tools carry exact prices in
  `structuredContent`. With the SDK's client the model would only see the spoken text and the
  host would never learn which view to render. Source: `dist/src/tools/mcp-tool.js` lines 35 to
  55 in the published package.
- Severity: Medium (one afternoon; changes the integration shape)
- Time lost: about 2 h
- Workaround: our own adapter lists the Bridge's tools once and wraps each as a Strands
  `tool()` with the server's JSON schema; the callback calls the Bridge through the
  simulator's MCP client, keeps the full result for the host, and returns the spoken text
  plus the structured facts to the model (`apps/simulator/src/server/agent/household-agent.ts`).
- Suggestion: surface `structuredContent` and result `_meta` on `McpTool` results (for
  example as a JSON block after the text) and expose tool `_meta` on the listed tools, so
  Strands agents can host MCP Apps without a second client.
- Link: apps/simulator/src/server/agent/household-agent.ts

## FL-005

- Date: 2026-09-16
- Tool: Amazon Bedrock model access and pricing pages, from a TypeScript build.
- What we tried: pin the exact Bedrock model ids and per-token prices for Nova 2 Lite and
  Claude Sonnet in `usage_events` before having an account with model access.
- Expected: model ids and prices a build can read, so the cost table needs no manual step.
- Actual: the model id an account can invoke depends on the region and on whether the
  model is served only through a cross-region inference profile (`us.` prefix), and the
  pricing page is not machine readable. Without credentials there is no way to check either,
  so the code ships an estimate table that has to be verified by hand.
- Severity: Low
- Time lost: about 30 min
- Workaround: `scripts/setup-wizard.sh` runs `aws bedrock list-foundation-models` and asks the
  human to paste the ids the account actually lists; `apps/simulator/src/server/agent/pricing.ts`
  keeps the estimates with a `BEDROCK_PRICING_JSON` override and marks unknown models.
- Suggestion: a public, unauthenticated JSON endpoint with model ids per region and list
  prices would let tools like this one record cost per call without a manual step.
- Link: scripts/setup-wizard.sh, apps/simulator/src/server/agent/pricing.ts

## FL-006

- Date: 2026-09-16
- Tool: Amazon Bedrock, Anthropic models on a new account (Converse API through Strands).
- What we tried: the first real guardian call on `us.anthropic.claude-sonnet-4-6` after the
  account listed the model and the IAM policy allowed `bedrock:InvokeModel`.
- Expected: an answer from the model, since the account listed it and IAM allowed the call.
- Actual: `ModelError: Model use case details have not been submitted for this
  account. Fill out the Anthropic use case details form before using the model. If you have
  already filled out the form, try again in 15 minutes.` Nothing in the model listing, in the
  IAM simulator or in the access page said that Anthropic models carry an extra, per-account
  form; Nova models on the same account answered at once. The guardian silently fell back to
  its rule, and only a usage row with `model = null` revealed it.
- Severity: Medium
- Time lost: about 45 min
- Workaround: the guardian takes a second strong model (`BEDROCK_MODEL_STRONG_FALLBACK`, Nova
  Pro by default) and records which model spoke; `scripts/bedrock-check.mjs` calls each
  configured model once and prints the form's location when it sees this error; the Bridge
  logs the fallback reason at `warn`.
- Suggestion: surface the use case requirement in `ListFoundationModels` (a field next to
  `inferenceTypesSupported`) and in the model access page, so tooling can tell "not enabled"
  from "enabled but gated" before the first invoke.
- Resolution: the model access page is retired and does not link the form; it lives on each
  Anthropic model's card in the Model catalog ("Submit use case details"). After submitting,
  `GetUseCaseForModelAccess` returned the form at once but invocation kept failing for about
  20 minutes before Claude Sonnet 4.6 answered.
- Link: packages/agents/src/guardian.ts, packages/bridge/src/main.ts, scripts/bedrock-check.mjs

## FL-007

- Date: 2026-09-17
- Tool: Amazon Bedrock runtime quotas on a new account (Nova 2 Lite cross-region profile, Converse through Strands).
- What we tried: measure cost per closed session by running five household sessions back to
  back, about four model calls per turn.
- Expected: either headroom for a handful of calls a minute, or a quota we could read before hitting it.
- Actual: after roughly a dozen calls within a minute, Converse answered `ModelError:
  Too many requests, please wait before trying again.` The SDK's own retries did not absorb it,
  and our simulator reported it as "I could not reach the store", which sent us looking at the
  Bridge first. Nothing in the console's model page shows the account's effective per-minute
  quota for a cross-region inference profile.
- Severity: Medium
- Time lost: about 25 min
- Workaround: pace the measurement (8 s between turns, 30 s back-off on throttling); the
  simulator now answers 429 and says the assistant is getting too many requests; the
  measurement then ran with zero throttled turns.
- Suggestion: show the applied requests-per-minute and tokens-per-minute quotas on each
  model's catalog card, and return a `Retry-After` hint with the throttling error so clients
  can back off precisely.
- Link: apps/simulator/src/server/app.ts, docs/COSTS.md

## FL-008

- Date: 2026-09-17
- Tool: AWS App Runner (CreateService, ListServices) from a deployment script, new account.
- What we tried: deploy the Bridge, the Simulator and the fixture Store as App Runner services,
  the path our architecture document and the hackathon's AWS guidance both pointed to.
- Expected: a service, or an error naming what is actually wrong.
- Actual: the image built in CodeBuild and landed in ECR, then the first App Runner
  call answered `SubscriptionRequiredException: The AWS Access Key Id needs a subscription for
  the service`. App Runner stopped accepting new customers on 2026-04-30
  (https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html). The
  error names a subscription, not the availability change, and the console, the IAM policy
  simulator and the SDK all still present the service as usable.
- Severity: High
- Time lost: about 40 min (script, roles, build, then the wall)
- Workaround: keep the image, the registry and the build; move the services to the successor
  AWS recommends (Amazon ECS Express Mode) or to Lambda with a web adapter.
- Suggestion: return a dedicated error such as `ServiceClosedToNewCustomers` with the
  availability page link, and show a banner in the App Runner console for accounts that cannot
  create services.
- Link: scripts/deploy-aws.mjs, docs/DEPLOY.md

## FL-009

- Date: 2026-09-17
- Tool: Amazon ECS Express Mode (CreateExpressGatewayService, getting started guide).
- What we tried: create three services whose environment carries each other's public URLs,
  using the URL format the guide documents: `https://<service-name>.ecs.<region>.on.aws/`.
- Expected: `https://<service-name>.ecs.<region>.on.aws` to resolve, as the getting started guide documents.
- Actual: the service reached ACTIVE with its task running and registered, but that
  host name did not resolve. The real endpoint is generated
  (`ag-<32 hex>.ecs.us-east-1.on.aws`) and appears only in
  `activeConfigurations[].ingressPaths[].endpoint` after creation. Our deploy waited 30 minutes
  on a name that never existed.
- Severity: Medium
- Time lost: about 45 min
- Workaround: create each service with a placeholder, read the generated endpoint from
  DescribeExpressGatewayService, then update the environment and wait for the rollout.
- Suggestion: correct the URL format in the getting started guide, and either return the
  endpoint in the CreateExpressGatewayService response or allow choosing the host prefix, so
  services that reference each other can be created in one pass.
- Link: scripts/deploy-aws.mjs

## FL-010

- Date: 2026-09-17
- Tool: Amazon Bedrock AgentCore Memory (CreateEvent, TypeScript SDK).
- What we tried: write one JSON event per order reference, following the SDK's payload union
  (`PayloadType.JsonMember`).
- Expected: the JSON value to go at `json`, which is what the payload union's member is named after.
- Actual: the union's member is `json: MemoryJsonData`, and the JSON value goes one
  level deeper, in `MemoryJsonData.content`. Passing the object straight to `json` compiles,
  because both are documents, and fails at runtime with `ValidationException: Value at
  'payload.1.member.json.content' failed to satisfy constraint: Member must not be null`. The
  error also numbers the payload from 1 while the array is indexed from 0, which sends you
  looking at the wrong element.
- Severity: Medium
- Time lost: about 30 min
- Workaround: write `payload: [{ json: { content: value } }]`, and read events back from
  `payload[].json.content`, accepting both an object and a JSON string.
- Suggestion: make the member a typed wrapper the compiler can check (or accept the value
  directly at `json`), show a complete CreateEvent example with a JSON payload in the memory
  guide, and number payload elements from 0 in the validation message.
- Link: apps/simulator/src/server/agentcore-memory.ts

## FL-011

- Date: 2026-09-17
- Tool: Strands Agents SDK for TypeScript (BedrockModel prompt caching) with Amazon Nova 2 Lite.
- What we tried: cut the Household agent's input cost, which is 99 percent of its token volume
  because seven tool schemas and the system prompt travel with every call, by turning on
  `cacheConfig: { strategy: "auto" }`.
- Expected: cached reads on the static prefix, or a warning that caching was not applied.
- Actual: nothing was cached and `cacheReadInputTokens` stayed at zero, with no warning.
  The SDK's auto-detection enables caching only for model ids containing "anthropic" or
  "claude", although Bedrock caches Nova as well. Forcing `strategy: "anthropic"` on the same
  Nova model works: the first call wrote 1,499 tokens to the cache and the second read 1,502.
  Forcing it then fails on the next call with `Malformed input request: #/toolConfig/tools/6:
  extraneous key [cachePoint] is not permitted`, and again on `#/messages/8/content/0`: Nova
  accepts the system checkpoint alone, so both the tool and the message checkpoints have to be
  turned off per family. With that, a Nova call writes about 2,300 tokens to the cache and the
  next call reads them.
  The strategy name also reads as a provider rather than a wire format.
- Severity: Medium
- Time lost: about 30 min
- Workaround: `packages/agents/src/cache.ts` names the strategy for the families we measured
  (Anthropic and Nova), asks Nova for the system checkpoint only, and leaves "auto" for the rest.
- Suggestion: include the Nova family in the auto-detection, rename the strategy after the
  cache point format rather than a provider, and log once when a requested cache config ends
  up disabled.
- Link: packages/agents/src/cache.ts, apps/simulator/src/server/agent/brain.ts

---

## FL-012

- Date: 2026-09-20
- Tool: Amazon ECS Express Mode with its generated Application Load Balancer.
- What we tried: keep `alexa.agentposhq.com` and `bridge.agentposhq.com` answering across a
  release. Both are host header rules on the listener Express Mode created, each copied from
  the rule of the service's generated `https://ag-<id>.ecs.us-east-1.on.aws` name, which is
  the only way to put your own name in front of a service: Express Mode has no custom domain
  of its own.
- Expected: a name that survives a deployment, since the service and its endpoint do.
- Actual: after the release the custom names answered `503 Service Temporarily Unavailable`
  from `awselb/2.0` while the generated names answered 200, with the same certificate, the
  same load balancer and the same two target groups in the rule. Express Mode deploys blue
  and green across two target groups per service and flips the forward weights on every
  deployment, updating only the generated name's rule: ours still read
  `tg-853dc=0, tg-129d2=100` when the live tasks were all in `tg-853dc`, so every request
  went to the empty group. Nothing in the deployment output mentions it, and a rule that
  lists both target groups looks correct in the console. Re-running our setup did not help
  either: the rule for the name existed, so it was left alone.
- Severity: High (the public playground's own names go dark after each release)
- Time lost: about 1 h, most of it spent trusting the target group ARNs, which never changed.
- Workaround: `scripts/custom-domain.mjs` compares target groups and weights, re-points an
  existing rule instead of skipping it, `infra/domains.json` holds the names, and
  `pnpm deploy:aws` runs the sync once the services are ready. `node scripts/custom-domain.mjs
  --sync` fixes it by hand.
- Suggestion: let an Express Mode service carry its own custom domain names, or move every
  rule that matches the service's target groups when the weights flip. Short of that, say it
  in the docs, and have the deployment output name the weight change: a rule copied from the
  generated one is the documented way to add a name, and it silently stops working.
- Link: scripts/custom-domain.mjs, infra/domains.json, docs/DEPLOY.md

---

## Tools that worked

No friction worth an entry, and worth saying so, since praise is feedback too.

- **MCP TypeScript SDK and MCP Apps** (`@modelcontextprotocol/server` 2.0,
  `@modelcontextprotocol/ext-apps` 2.0). Streamable HTTP, stateless, `registerAppTool` and
  `ui://` resources behaved exactly as documented. Our four views were rendering inside an
  Echo Show frame the same afternoon we started them.
- **Universal Commerce Protocol schemas.** The vendored release validates our checkout
  sessions with ajv without a single local patch, which is rare for a spec this young. The
  payment handler examples are precise enough to implement from.
- **Amazon Polly generative voices.** One call, one audio stream, good prosody on numbers and
  prices in English and Spanish. It also narrates our demo video.
- **Amazon ECR and AWS CodeBuild.** From no registry to an image built from a public
  repository and pushed, in one script and under two minutes per build.
- **Amazon Bedrock Converse through Strands Agents.** Once the account was open (FL-006), tool
  use, structured answers and usage metadata were steady across Nova 2 Lite, Nova Pro and
  Claude Sonnet 4.6. Swapping models is a string.
- **Bedrock AgentCore Memory** after its payload shape was clear (FL-010): create, wait for
  ACTIVE, write events, read them back, with no infrastructure of our own.
- **Stripe Node SDK.** Idempotency keys, test payment methods and typed card errors made the
  merchant's own processor the least surprising part of the payment work.
- **Node 22 and 24**, `node:sqlite` unflagged and `process.loadEnvFile`. A judge runs this
  with one command and no services to create, which is the whole point of the local demo.
