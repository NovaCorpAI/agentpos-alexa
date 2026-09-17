# Submission draft: Build, Ship, Shape Amazon Developer Hackathon 2026

Working draft of every field the Devpost form asks for. Sources: rules at
https://amazonappdev2026.devpost.com/rules, checked on 2026-09-15.

## Dates and mechanics

| Step | When | Notes |
| --- | --- | --- |
| Register ("Join Hackathon") | now; no separate deadline | Devpost account, one click |
| Draft submission | now, edited as often as needed | "Prior to the end of the Submission Period, you may save draft versions of your submission on Devpost" |
| Internal freeze | Monday 19 October 2026 | final video uploaded, numbers filled |
| Submission deadline | Friday 23 October 2026, 12:00 pm Pacific Time | nothing can change after this |
| Judging, Stage One | 9 to 20 November 2026 | pass or fail on baseline viability |
| Judging, Stage Two | same window | four equally weighted criteria, up to 10 percent bonus for friction logs |
| Winners announced | on or around Thursday 3 December 2026 | |

The draft is created on day one with the description below and the repository link, and
updated at every milestone, so that a missed freeze still leaves a complete entry on file.

## Form fields

| Field | Value |
| --- | --- |
| Project name | AgentPOS for Alexa+ |
| Tagline | Turn any existing online store into an Alexa+ add-on with in-conversation checkout. The store is merchant of record; the merchant chooses how to get paid. |
| Track | Alexa+ |
| Mini challenges | AWS Builder, Open Source |
| Repository | https://github.com/NovaCorpAI/agentpos-alexa (Apache-2.0) |
| Video | YouTube, public, English, under 3 minutes (script below) |
| Built with | TypeScript, Node 22, Hono, node:sqlite, MCP SDK, Amazon Bedrock (Nova 2 Lite, Nova Pro, Claude Sonnet 4.6), Bedrock AgentCore Memory, Strands Agents SDK, Amazon Polly, Amazon ECS Express Mode (Fargate), Amazon ECR, AWS CodeBuild, x402, Stellar |
| Existed before? | AgentPOS (the store side: catalog, quotes, policies, receipts, settlement) existed before the hackathon and is a separate repository. Everything in this repository is new: the MCP server for Alexa+, the UCP checkout sessions, the payment rails, the merchant agents on AgentCore, the simulated Alexa+ client. See "What we built" below. |

## Project description (draft, plain text for the form)

**The problem.** Alexa+ for Builders is for Priceline. The corner store, the bakery with a
WooCommerce site, the bookshop with 300 titles, has no path to be bought from by voice. They
will not get a partner manager, and they will not rebuild their store around a new protocol.

**What this is.** AgentPOS for Alexa+ is the bridge Amazon describes as an add-on, deployed in
front of any store that runs AgentPOS. It consumes the store's public surfaces (MCP, REST,
`/.well-known/ucp`, checkout) and exposes the Alexa+ contract: an MCP server (spec 2025-11-25,
Streamable HTTP, MCP Apps for the carousel, order card and receipt card) and the UCP checkout
sessions Alexa+ documents (create, get, update, complete, cancel; OAuth 2.0; 24 hour
idempotency; 6 hour sessions; business errors as `messages[]`).

**The merchant chooses how to get paid.** Three payment handlers behind one interface: the
merchant's own PSP through the UCP processor tokenizer handler (Stripe in test mode for the
demo; the charge appears in the store's Stripe dashboard with the store as merchant of
record), Amazon Wallet (`com.amazon.payments.network_token` and `stored_payment_method`,
implemented against the published contract and exercised with a clearly labeled simulated PSP
while the program is in preview), and USDC on Stellar through x402 when the agent brings a
wallet. Nothing in the bridge holds a key or funds. No order exists without settled payment.

**Three merchant agents, each visible in the demo.** Onboarding turns a store URL into a
voice-ready catalog (spoken names, one-sentence summaries, synonyms) and proposed voice
policies on Claude Sonnet 4.6, and nothing is published until the merchant confirms; every
stage is timestamped. Catalog answers what a flat catalog cannot ("is it gluten free?", "does
it contain nuts?") on Nova 2 Lite, reading only what is published, and says "the store has
not published that" instead of guessing. Guardian stops a duplicate order before any money
moves and asks the household in one spoken sentence; the next confirmation is the answer. Each
agent runs a deterministic rule first, so the demo works without credentials, and the model
only words what the rule found. The household's memory ("the same as last week") lives on
Amazon Bedrock AgentCore Memory and holds order references only. Every model call records
tokens, latency, model and cost in `usage_events`: a closed checkout session costs
US$0.0021 in inference, measured over five sessions (`docs/COSTS.md`).

**The simulated Alexa+ experience.** Amazon's tooling is available to partners only, so the
simulator is an Echo Show style web app, voice in and out, whose agentic client runs on
Bedrock and drives the bridge end to end, rendering the same components and display modes the
add-on guide documents. It is also the public playground: real stores, real third-party
purchases.

**Impact, measured.** From store URL to first voice purchase: [N] minutes, median of 5 real
WooCommerce stores. [K] stores we do not control live before submission. [M] purchases by
third parties from the public simulator. All from `usage_events`, exportable as CSV.

**Open source.** Apache-2.0 from the first commit. The x402 payment handler is proposed to the
Universal Commerce Protocol with this repository as reference implementation, and the
`PaymentRail` interface is upstreamed to the AgentPOS core.

## What we built during the hackathon (required when the project existed before)

New in this repository: `packages/bridge` (MCP server with seven tools and four MCP Apps
views, UCP checkout sessions, simulated Amazon handlers, onboarding routes, Voice overlay,
storage), `packages/agents` (onboarding, catalog and guardian on Strands with Bedrock),
`apps/simulator` (Echo Show style client with a Bedrock household agent, Polly voice, host
checkout pattern, Scenes 1 to 5, Merchant console, AgentCore Memory), `packages/store-client`,
`packages/fixture-store`, the deployment (`infra/`, `scripts/deploy-aws.mjs`) and all
documentation.
Pre-existing and unchanged: the AgentPOS store software the bridge talks to.

## Video script (under 3 minutes, English)

| Time | Scene | What is on screen |
| --- | --- | --- |
| 0:00 | Hook | "Alexa+ for Builders is for Priceline. This is for the corner store." A real WooCommerce store URL is pasted. |
| 0:10 | Onboarding | The agent scans, drafts the voice-ready catalog and policies. The merchant reviews and confirms. Timer running. |
| 0:50 | First voice purchase | Echo Show frame. "Alexa, order two loaves of sourdough from Panaderia X." Carousel, item card, checkout, receipt card with the verified badge. Timer stops: "URL to first purchase in N minutes." |
| 1:20 | The merchant chooses the rail | The Stripe test dashboard shows the charge on the store's account. Then the Amazon Wallet handler, labeled SIMULATED on screen. Then a USDC settlement hash. |
| 1:50 | Agents visible | "Is it gluten free?" answered from the published catalog. A duplicate order blocked by the guardian with a one-sentence reason. "The same as last week" from memory. |
| 2:20 | Impact | Three real stores, third-party purchases counter, cost per session from usage_events. |
| 2:40 | Close | Repo, Apache-2.0, the UCP proposal, the friction log. |

## Product feedback (required field)

Taken from `docs/FRICTION-LOG.md` (nine entries on 2026-09-17). Lead with FL-002 (publish the
Local Inspector on public npm), FL-003 (a sandbox for the network token handler), FL-008 (App
Runner closed to new customers behind a `SubscriptionRequiredException`) and FL-006 (the
Anthropic use case form on Bedrock is invisible until the first invoke fails).

## Checklist before submitting

- [ ] Repository public, `LICENSE` present, README runs in one command from a clean clone.
- [ ] Video under 3 minutes, English, public on YouTube, shows the simulated experience clearly.
- [ ] Impact numbers filled from `usage_events` export, with the CSV committed under `docs/impact/`. Cost per closed session done (US$0.0021, `docs/impact/usage-events.csv`); onboarding time on real stores and third-party purchases pending.
- [ ] Friction log with at least ten entries, each with date, severity, time lost, workaround, suggestion. Nine so far.
- [ ] `.env.example` current; git history scanned for secrets.
- [ ] Track: Alexa+. Mini challenges: AWS Builder, Open Source.
- [ ] "Existed before" explanation matches the repository history.
