# Friction log

Written while building, one entry per obstacle with an Amazon or AWS SDK, API, simulator,
console or document. Severity: Blocking (could not proceed), High (hours lost), Medium
(confusion, quick workaround), Low (detail).

Each entry: date, tool, what we tried, what happened (exact error, observed behavior, doc
link), severity, time lost, workaround, concrete suggestion for the Amazon team, link to the
commit or file.

---

## FL-001

- Date: 2026-09-14
- Tool: Alexa+ MCP Toolkit and Alexa+ for Builders
- What we tried: enroll to register a self-hosted MCP add-on from a company account in Chile.
- What happened: the MCP Toolkit overview states "The MCP Toolkit is available in the United
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
- What happened: both packages must be pulled from a private AWS CodeArtifact registry
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
- What happened: the checkout doc states "You receive an encrypted token only you can decrypt"
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
- What happened: `McpTool.stream` maps only `result.content` (text, image, embedded resource)
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
- What happened: the model id an account can invoke depends on the region and on whether the
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
