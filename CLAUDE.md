# CLAUDE.md, AgentPOS for Alexa+

Instructions for Claude Code (and any AI coding agent) working in this repository.

## What we are building

The Alexa+ add-on for AgentPOS stores: "the bridge you deploy" (Amazon's definition) between a
store's MCP server and Alexa+. It consumes any AgentPOS store through its public surfaces
(MCP at `/agentpos/mcp`, REST API, `/.well-known/ucp`, x402 checkout) and exposes the full
Alexa+ contract: MCP with MCP Apps, and the UCP-compatible checkout (`/checkout-sessions`
create, get, update, complete, cancel; OAuth 2.0; 24 h idempotency; 6 h sessions). Read
`README.md` and `docs/ARCHITECTURE.md` first.

Thesis for judges: "Alexa+ for Builders is for Priceline. AgentPOS is for the corner store."

## Hard rules (inherited from AgentPOS; breaking them breaks the project)

1. **Zero custody.** Never store a merchant's or a household's private key, PSP key or secret. The
   bridge orchestrates; it does not hold funds.
2. **The store is merchant of record.** No commission, no take rate, no marketplace, no
   central listing. If a feature turns us into an intermediary, stop and ask.
3. **No order without settled payment.** `complete` succeeds only after the store confirms
   settlement with a transaction hash. Idempotent by transaction hash.
4. **Human confirmation before publishing.** The onboarding agent drafts; a human confirms.
5. **Protocol adapters.** Every contact with MCP, UCP and x402 formats lives under
   `packages/bridge/src/{mcp,profile,checkout,rails}/` with versions pinned in
   `packages/bridge/src/versions.ts`. Specs will change; nothing else imports them directly.
6. **Integers for money**, minor units (USDC has 7 decimals). Never floats.
7. **Official SDKs only** for cryptography and payments (`@x402/*`, `@stellar/stellar-sdk`,
   `@modelcontextprotocol/sdk`). Never reimplement verify or settle.
8. **Testnet by default.** Mainnet requires an explicit flag and the founder's explicit
   confirmation, and only against the already authorized demo store.
9. **The Amazon payment handlers are simulated** (the program is in preview): implemented
   against the published contract, exercised with a simulated PSP, labeled as such in code,
   logs and UI. The x402 rail is real. Never blur the two.
10. No secrets in the repo. `.env.example` always current.

## Stack

TypeScript strict, Node >= 22.13, pnpm workspaces, Hono, `node:sqlite` (unflagged since 22.13) behind a storage
adapter (a judge must run this with one command and no services to create), vitest.
AWS: Amazon Bedrock (Nova 2 Lite for frequent cheap steps, Claude Sonnet via Bedrock or Nova
Pro for critical decisions), Bedrock AgentCore Runtime and Memory, Strands Agents SDK,
us-east-1. Document every AWS service with file paths in `docs/AWS-INTEGRATION.md`.

## Conventions

- Code, identifiers, comments, commits, docs: English. Conventional commits.
- Errors are typed with a machine-readable code: `{ code, message, hint }`.
- Every model call records input tokens, output tokens, latency, model and estimated cost in
  the `usage_events` table (SQLite), exportable to CSV.
- Every obstacle with Amazon or AWS tooling (docs, SDK, simulator, console) gets a same-day
  entry in `docs/FRICTION-LOG.md`: date, severity, time lost, workaround, concrete suggestion,
  link to the commit.
- No em dashes in any generated text.
- Structured JSON logs with a `traceId` that crosses MCP call, checkout session, store
  request and settlement.

## Build order

Rationale in `docs/STRATEGY.md`. The simulator is built second because it is where design is
judged; every agent is instrumented in `usage_events` from its first call.

1. `store-client` against `https://demo.agentposhq.com` and the AgentPOS `demo-store` docker
   (testnet, physical goods). The `usage_events` schema is defined first
   (`packages/bridge/src/storage/usage-events.ts`, `docs/USAGE-EVENTS.md`).
2. `apps/simulator` skeleton: Echo Show style screen, voice in and out, MCP Apps rendering
   (carousel, order card, receipt card) with fixed data. Grows with the bridge from here on.
3. `bridge`: MCP server for Alexa+ (voice-ready item data, few well-named tools, Amazon's MCP
   design guidance), `checkout-sessions` translated to the store's cart, quote and payment;
   idempotency; TTL; `messages[]`; UCP profile conformance-tested against vendored official
   schemas. Rules in `docs/ALEXA-MCP-DESIGN.md`; Amazon's own tooling is closed (FL-002), so
   the simulator is the validation surface.
4. Rails on `complete`, in order of presentation: merchant PSP (Stripe test mode, charge
   executed by the store; the bridge never holds the key), Amazon handlers simulated and
   labeled, x402 real (with a buyer mandate from `@agentpos/mcp-buyer` in the simulator).
5. `agents` on AgentCore, one demo scene each: onboarding (URL to first voice purchase, every
   stage timestamped), catalog ("is it gluten free?", reads only what is published), guardian
   (blocks a duplicate, explains in one sentence), memory ("the same as last week", order
   references only).
6. Public simulator on App Runner, waitlist, `usage_events` export, README sections, diagram,
   video. Onboarding timed on 5 stores; three real stores not ours before 19 Oct 2026 (internal target; official deadline 23 Oct 2026, 12:00 pm PT).

## Relationship with other repositories

- **AgentPOS monorepo** (`NovaCorpAI/agentpos`, public from 12 Oct 2026): provides the stores
  this bridge talks to. What belongs in the core (a `PaymentRail` interface, native UCP
  checkout in `packages/site`) is upstreamed there as a pull request once it is open.
- **agentpos-doorstep** (Ring track): consumes the orders and receipts that stores emit and
  proposes an `order.delivered` receipt event with third-party attestation.

## Definition of done per feature

Works in the simulator; has a test; records `usage_events`; documented in the README; can be
shown in 20 seconds of video.

## Agent skills

Project-local skills live in `.claude/skills/` (origin and rationale in
`.claude/skills/README.md`). Use `/grill-with-docs` before designing a module, `tdd` at agreed
seams while building, `research` for anything that needs primary sources, and `/to-tickets`
to turn a plan into GitHub issues.

### Issue tracker

GitHub Issues in this repo, through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single context: `CONTEXT.md` at the root for the glossary, decisions in
`docs/ARCHITECTURE.md`, ADRs only when warranted. See `docs/agents/domain.md`.
