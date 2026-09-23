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
| Video | https://youtu.be/Jfyoqvlb-7I (public, English, 2 min 17 s; shot list in `docs/VIDEO.md`) |
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
while the program is in preview), and USDC on Stellar through x402, which settles for real on
the Stellar testnet: the household's wallet signs, the store verifies and submits the transfer
as its own facilitator, and the order carries the transaction hash the network recorded,
verifiable in any explorer. Nothing in the bridge holds a key or funds. No order exists
without settled payment.

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

**What a household actually gets.** One cart per store: naming a second item joins the
session that is open, the store re-quotes the whole cart, and one payment closes it. A
reloaded browser finds its purchase where it left it, because the session lives in the bridge
for six hours. And the household can ask about itself: "how much have I spent this month"
is answered by the host from sessions that settled, with its own card, because the store
answers about its catalog and the host answers about you. The whole surface, interface,
assistant, cards and scenes, switches between English and Spanish with one control, and opens
in the visitor's own language.

**Try it:** https://alexa.agentposhq.com/ (merchant console at `/#/merchant`).

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

Shot by shot, with the system's verified answers and the voice over to read: `docs/VIDEO.md`.
Replay the sequence with `pnpm demo:run <simulator url>`.

| Time | Scene | What is on screen |
| --- | --- | --- |
| 0:00 | Hook | "Alexa+ for Builders is for Priceline. This is for the corner store." A real WooCommerce store URL is pasted. |
| 0:10 | Onboarding | The agent scans, drafts the voice-ready catalog and policies. The merchant reviews and confirms. Timer running. |
| 0:50 | First voice purchase | Echo Show frame. "Alexa, order two loaves of sourdough from Panaderia X." Carousel, item card, checkout, receipt card with the verified badge. Timer stops: "URL to first purchase in N minutes." |
| 1:20 | The merchant chooses the rail | The checkout offers the store's own Stripe first, labeled TEST MODE: the Stripe test dashboard shows the charge on the store's account (pi_...). Then the Amazon Wallet handler, labeled SIMULATED on screen. Then a USDC settlement hash. |
| 1:50 | Agents visible | "Is it gluten free?" answered from the published catalog. A duplicate order blocked by the guardian with a one-sentence reason. "The same as last week" from memory. |
| 2:20 | Impact | Three real stores, the public playground's third-party purchase counter, US$0.0021 per closed session from usage_events. |
| 2:40 | Close | Repo, Apache-2.0, the UCP proposal, the friction log. |

## Evidence on file (2026-09-21)

`pnpm submission:bundle` gathers all of it into one zip for the form's file upload: the costs
and the raw rows behind them, the AWS integration with file paths, the friction log, the
decisions and the stills from the recorded demo. Every file in it is a copy of a file in the
repository.

| Claim | Where it is verifiable |
| --- | --- |
| Demo video, filmed against the live deployment, 2 min 17 s | https://youtu.be/Jfyoqvlb-7I |
| Hosted playground, five Scenes green | https://alexa.agentposhq.com/ |
| The merchant's own Stripe charges the card, in test mode | `pi_3UGkN5375U7THQYH0sTSjSMZ` (public), `pi_3UGjrV375U7THQYH1WeScCOB` (by voice), Stripe test dashboard |
| USDC on Stellar settles for real, on the deployed playground | order `ord_AJPQcJahpl-K`, transaction `a544d97e6c96c86805c7ab46290465a33bbc3ca7fd4c9af52757a774f7bc6bfd`, ledger 4823125, https://horizon-testnet.stellar.org/transactions/a544d97e6c96c86805c7ab46290465a33bbc3ca7fd4c9af52757a774f7bc6bfd |
| Cost per closed checkout session: US$0.0021 | `docs/COSTS.md`, `docs/impact/usage-events.csv` (63 rows) |
| Onboarding: URL to first voice purchase | 28 s on the fixture Store, from `usage_events` stage rows |
| Household memory on AgentCore Memory | memory `agentpos_alexa_household` in us-east-1, Scene 4 |
| One cart per store, and a reload that keeps it | `apps/simulator/src/server/checkout.ts`, test in `app.test.ts` |
| The household's own spending, answered by the host | `packages/bridge/src/checkout/household.ts`, `GET`-free by design, tests in `household.test.ts` |
| English and Spanish across the whole surface | `apps/simulator/web/src/i18n.ts`, `packages/bridge/apps/shared/strings.ts` |
| Twelve friction entries | `docs/FRICTION-LOG.md` |

## Uploading the video

The file is `.data/video/agentpos-alexa-demo.mp4` (2 min 17 s, 1920 by 1080, 9 MB) and a copy
sits on the desktop. Thumbnail: `docs/assets/youtube-thumbnail.png` (1280 by 720).

Title:

```
AgentPOS for Alexa+: buy from the corner store, by voice
```

Description, to paste as it is:

```
Alexa+ for Builders is built for Priceline. This is for the corner store.

AgentPOS for Alexa+ is the add-on a small store can afford: it sits in front of any AgentPOS
store and speaks the Alexa+ contract, MCP for the catalogue and UCP checkout sessions for the
payment. The store stays the merchant of record, and the bridge never holds a key or a cent.

Filmed against the live playground, nothing staged:
0:00 Alexa+ for Builders is for Priceline. This is for the corner store.
0:06 A store answering over MCP, in its own published words
0:19 A baker onboards her store: an agent drafts how each item should sound, she confirms
0:29 Buying as a conversation, with the checkout as the host's pattern
0:40 Her own Stripe charges the card in test mode; the Amazon wallet handlers are simulated and labeled
0:49 A guardian checks before the money moves, and the household decides
1:09 One cart, item by item
1:28 Memory: the same as last week, from order references only, on AgentCore Memory
1:39 What this household has spent here this month, answered by the host
1:51 One switch, and the whole thing speaks Spanish

Try it: https://alexa.agentposhq.com
Merchant console: https://alexa.agentposhq.com/#/merchant
Code, Apache-2.0: https://github.com/NovaCorpAI/agentpos-alexa

Built on Amazon Bedrock (Nova 2 Lite, Claude Sonnet 4.6), Bedrock AgentCore Memory, Amazon
Polly, Amazon ECS Express Mode, Amazon ECR and AWS CodeBuild, with the Strands Agents SDK and
the Model Context Protocol TypeScript SDK. A closed checkout session costs US$0.0021 in
inference, measured, with every model call recorded.

Built in Chile by NovaCorp AI.
```

YouTube turns the list into chapters only when the first timestamp is 0:00 and there are at
least three of them, which is why the title card has a line of its own.

Tags: `alexa`, `alexa plus`, `mcp`, `model context protocol`, `amazon bedrock`, `agentcore`,
`ucp`, `checkout`, `voice commerce`, `small business`, `strands agents`, `aws`.

Uploaded on 2026-09-21 as https://youtu.be/Jfyoqvlb-7I, and set in the Devpost form.

## Product feedback (required field)

Taken from `docs/FRICTION-LOG.md` (twelve entries, 2026-09-15 to 2026-09-20). Lead with FL-002
(publish the Local Inspector on public npm), FL-003 (a sandbox for the network token handler),
FL-008 (App Runner closed to new customers behind a `SubscriptionRequiredException`) and FL-006
(the Anthropic use case form on Bedrock is invisible until the first invoke fails). Then
FL-012: Express Mode flips the forward weights between a service's two target groups on every
deployment and updates only the generated name's rule, so the custom domain an operator added
beside it answers 503 after each release, with nothing in the output to say so. The rest are
AgentCore Memory payload typing (FL-010), Bedrock prompt caching on Nova (FL-011), Express
Mode endpoints (FL-009), Bedrock quotas (FL-007) and model ids and prices (FL-005).

## Checklist before submitting

- [x] Repository public, Apache-2.0 detected by GitHub, and a clean clone installs, builds and runs the three services (checked 2026-09-17 and 2026-09-19).
- [x] Video under 3 minutes, English, public on YouTube, shows the simulated experience clearly: https://youtu.be/Jfyoqvlb-7I
- [ ] Impact numbers filled from `usage_events` export, with the CSV committed under `docs/impact/`. Cost per closed session done (US$0.0021, `docs/impact/usage-events.csv`); the public purchase counter now survives releases (`docs/impact/purchases.json`, 7 third-party purchases and 2 of ours as of 2026-09-23); onboarding time on real stores pending on #22.
- [x] Friction log with at least ten entries, each with date, severity, time lost, workaround, suggestion.
- [x] `.env.example` covers every key the local `.env` sets; the whole history scanned for Stripe, AWS and private-key patterns, and for committed `.env` or credential files: nothing found (2026-09-19).
- [ ] Track: Alexa+. Mini challenges: AWS Builder, Open Source. (Chosen on the form itself.)
- [x] "Existed before" matches the history: first commit 2026-09-14 scaffolding this add-on, 69 commits, and no store-side code in the tree.
