# Strategy: from a good add-on to a winning one

Written 2026-09-15, before the bridge, the simulator and the agents exist. This document
records why the build order and the payment rail hierarchy changed, so that later decisions
can be checked against it. Product and demo strategy only; the hard rules live in `CLAUDE.md`.

## Four risks a judge will see

1. **"A crypto project."** A judge from the Alexa+ team sees USDC and Stellar and files the
   project as foreign to their roadmap, which is Amazon Wallet and the merchant's own PSP.
2. **The simulator is where design is judged, and it does not exist yet.** Everyone who cannot
   enroll in the program will arrive with a simulated web app. Most will be ugly chats.
3. **The agentic part is hidden.** Alexa+ is the visible agent; our merchant agents work in
   the back. If they are not shown, the jury sees "an MCP server".
4. **Impact is a promise** until real stores that are not ours are live.

## Five moves

### 1. A real fiat rail in test mode, not only a simulated one

On `complete` with the Amazon handler, the network token goes to the merchant's PSP: Stripe in
test mode, on the demo store's own account. The charge appears in the store's Stripe dashboard
with the merchant as merchant of record. The sentence for the jury becomes: **the merchant
chooses how to get paid: their PSP today, Amazon Wallet when the program opens, USDC if the
agent brings a wallet.** USDC stops being the thesis and becomes an option.

Constraint from hard rule 1 (zero custody): the bridge never holds the merchant's Stripe
secret key. The charge is executed by the store, behind the `PaymentRail` interface that is
upstreamed to the AgentPOS core; the bridge relays the token the same way it relays the x402
payload. Fallback if the core is not ready in time: Stripe Connect with the merchant's OAuth
grant, revocable, never the raw secret key.

To verify in week 0: whether Stripe test mode accepts third-party network tokens. If it does
not, the charge is real (test mode) but the translation from the Amazon token to a Stripe
payment method is simulated, and that step is labeled as such (hard rule 9).

### 2. The onboarding agent is the opening scene of the video

A URL of a real WooCommerce store, on camera: scan, voice-ready catalog, proposed policies,
human confirmation, first purchase by voice. Timed. The number **"from URL to first voice
purchase in N minutes, median of 5 stores"** is the strongest impact metric available, and it
is measurable. Requirements in the repo: the onboarding agent records a timestamp per stage in
`usage_events` from day one, and the run is a reproducible script, not only a video.

### 3. A simulator that feels like Alexa+

Echo Show style screen, voice in and out, and the real MCP Apps: product carousel, order card,
receipt card with a verified badge. Follow Amazon's MCP design guidance literally (data shaped
for voice, few well-named tools). If the Alexa AI CLI or a local inspector can be downloaded
without enrollment, validate the add-on with Amazon's own tool. Verified in week 0 and logged
in `docs/FRICTION-LOG.md` either way. The simulator moves from step 4 to step 2 of the build
order, with fixed data at first.

### 4. The three agents visible in the demo, one action each

- **Catalog** answers what a flat catalog cannot ("is it gluten free?") reading only what is
  published. Demonstrates: never invents price or availability.
- **Guardian** blocks a duplicate of the same order from five days ago and explains why in one
  voice-ready sentence. Demonstrates: adds context to the store's deterministic policy.
- **Onboarding** already appeared in scene one. Demonstrates: a human confirms before publishing.
- **Memory across sessions**, which Amazon values: "order the same as last week". That memory
  belongs to the household, not to the merchant. The bridge stores a reference to the order in
  the store, never the content, and the store resolves it. Keeps logs free of PII.

### 5. Three real stores we do not control, before 19 October 2026 (internal target)

The lighthouse stores of the SCF plan qualify. With them the impact section stops being a
projection: stores, third-party purchases from the public simulator, waitlist, and the measured
onboarding time. Repo requirements: the public simulator deployed on App Runner, a waitlist
with storage, and `usage_events` distinguishing our own purchases from third-party ones.

## Two cheaper reinforcements

- **Open source contribution to the UCP repository**: propose the x402 payment handler for the
  standard. Visibility with Google and Amazon at once. A reference implementation must exist
  first in `packages/bridge/src/profile/`; a proposal without code tends to stay an open issue.
- **A friction log with ten real entries.** The easiest 10 percent of the contest to win. One
  entry per obstacle, written the same day.

## What changed in the repository on 2026-09-15

1. README and `docs/ARCHITECTURE.md` present the rails in the new order: merchant PSP, Amazon
   Wallet, USDC via x402.
2. `packages/bridge/src/versions.ts` declares the third handler (`dev.ucp.processor_tokenizer`
   behind the store's `PaymentRail`), and `.env.example` documents that the Stripe key lives in
   the store, never in the bridge.
3. `CLAUDE.md` build order: simulator at step 2, agents instrumented for timing from the start.
4. The `usage_events` schema is defined before any module writes to it
   (`packages/bridge/src/storage/usage-events.ts`, `docs/USAGE-EVENTS.md`), with fields for the
   onboarding stage and the purchase origin (own or third party).

## Verified on 2026-09-15 (week 0 checks)

Sources and detail in `docs/FRICTION-LOG.md` (FL-002, FL-003) and `docs/ALEXA-MCP-DESIGN.md`.

- **Amazon's tooling is closed.** The Alexa AI CLI, the Local Inspector and the web simulator
  are only reachable through a private CodeArtifact registry granted during partner
  onboarding. Move 3 therefore rests entirely on `apps/simulator` following the published
  design guide; the simulator produces its own inspection summary with the fields the Local
  Inspector documents.
- **Stripe does not accept third-party network tokens.** The Amazon `network_token` handler
  cannot be turned into a real Stripe test charge. The real fiat rail is instead the
  UCP-sanctioned `dev.ucp.processor_tokenizer` handler with Stripe test mode as processor (the
  client tokenizes with Stripe, the store charges). The Amazon handlers stay simulated and
  labeled. This is cleaner than the original plan: the fiat rail uses a handler that already
  exists in the standard, and no vendor namespace is invented.
- **The official deadline is Friday 23 October 2026, 12:00 pm Pacific Time.** 19 October is
  our internal target for the three real stores and the final video.
- **Judging is four equally weighted criteria**: Tech Implementation, Design, Potential Impact,
  Quality of the Idea, plus up to 10 percent bonus for friction log submissions in the first
  downselection. Chile is eligible; the simulated path is explicitly allowed and exempt from
  the runtime hook requirement as long as the source is in the repo and the video shows it.
- **UCP governance for the x402 handler.** Vendors must publish new handlers under their own
  reverse-domain namespace with the spec and schema hosted on that domain; core adoption needs
  an Enhancement Proposal and Tech Council approval after proven adoption. No x402 proposal
  exists in the UCP organization. Path: publish `com.agentposhq.x402` with the spec hosted on
  agentposhq.com and this repository's `profile/` module as reference implementation, then
  open the proposal issue.
