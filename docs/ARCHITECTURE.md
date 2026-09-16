# Architecture

```
Alexa+ (preview, US partners)      |   apps/simulator (Echo Show style web app, Bedrock + Strands client, official alternative path)
        \                          |          /
         MCP Streamable HTTP 2025-11-25 + MCP Apps   |   UCP checkout 2026-04-08 (REST, OAuth 2.0)
                                   v
        packages/bridge  (the add-on: Hono, Node 22.13, node:sqlite)
          |-- mcp/            MCP server for Alexa+: voice-ready item data, carousel, order card, receipt card with verified badge
          |-- checkout/       checkout-sessions: create, get, update, complete, cancel; 24 h idempotency; 6 h TTL; messages[]
          |-- rails/          merchant PSP (Stripe test mode, executed by the store) | com.amazon.payments.* (contract-complete,
          |                   simulated PSP, labeled) | org.x402.stellar (real USDC settlement when the agent brings a wallet)
          |-- profile/        /.well-known/ucp with dev.ucp.shopping and payment handlers
          |-- storage/        sessions, idempotency keys, usage_events (schema in docs/USAGE-EVENTS.md)
                                   v
        packages/store-client  ->  any AgentPOS store: /agentpos/mcp, REST (items, cart, quote, checkout),
                                   /.well-known/ucp, merchant policy, human approval queue, signed receipts,
                                   PaymentRail (the store executes the charge; the bridge never holds a PSP key)
                                   (demo.agentposhq.com: authorized demo store; AgentPOS demo-store docker: testnet, judges)
                                   v
        packages/agents (Strands Agents SDK on Bedrock AgentCore Runtime, us-east-1)
          |-- onboarding  (strong model, once per store; human confirms; every stage timestamped in usage_events)
          |-- catalog     (Nova 2 Lite, frequent; reads only the published catalog)
          |-- guardian    (strong model, only at completion; explains in one voice-ready sentence)
          |-- AgentCore Memory (per-store preferences; household memory stores order references only)
```

## Decisions

- **A bridge, not a fork.** The store keeps running AgentPOS unchanged; the add-on consumes
  its public surfaces. That is Amazon's own definition of an add-on, and it means a judge can
  run this today against the public demo store.
- **Merchant side, not household side.** Alexa+ is the household's agent and Amazon Wallet is
  its wallet. Our value is making the long tail of stores safely reachable.
- **The merchant chooses the rail.** Three handlers behind one `PaymentRail` interface, in
  this order of presentation: the merchant's own PSP (Stripe in test mode for the demo; the
  store executes the charge, the bridge relays the token and never holds the key), Amazon
  Wallet (implemented against the published contract, exercised with a simulated PSP, labeled
  as such because the program is in preview), and USDC on Stellar through x402 when the agent
  brings a wallet. See `docs/STRATEGY.md` for why this order.
- **One checkout, five surfaces.** The UCP checkout the bridge serves for Alexa+ is the same
  contract Google AI Mode, Gemini, Copilot Checkout and YouTube Shopping consume.
- **The simulator is built second, not fourth.** It is where design is judged; it starts with
  fixed data and grows with the bridge.
- **Agents are visible.** Each agent has one scene in the demo and is instrumented in
  `usage_events` from its first call, including onboarding stage timestamps.
- **SQLite by default.** No services to create. Postgres for the hosted tier.
- **Testnet for reproducibility, mainnet for the video.** Judges run against the docker demo
  store on testnet; one real mainnet purchase is recorded against the authorized demo store.
- **Upstream what belongs upstream.** A `PaymentRail` interface and native UCP checkout are
  contributed to the AgentPOS core once its repository is public. The x402 handler is proposed
  to the UCP standard with this repository's `profile/` module as reference implementation.

- **Simulator stack.** One Node process (Hono) serves the React and Vite interface and runs the
  Household agent with the Strands TypeScript SDK on Bedrock (Nova 2 Lite by default, model
  chosen by environment, every call in `usage_events`). Two MCP SDK lines coexist behind an
  adapter: Strands brings its MCP client on SDK 1.x, MCP Apps 2.0 needs SDK v2; both are pinned
  in `versions.ts`.
- **Views live in the Bridge.** Carousel, item card, order card and receipt card are `ui://`
  resources served by the Bridge's MCP server, built to one HTML file each. The Simulator only
  hosts them through the official app bridge, so they render identically in Alexa+.
- **Scenes and Free mode.** Five Scenes (first voice purchase, "is it gluten free?", duplicate
  blocked, "the same as last week", onboarding timed) run the real agent with prerecorded
  inputs and emit an Inspection summary each. Free mode is the public playground.
- **Echo Show only.** Two device frames (small and large) and four display modes: inline,
  fullscreen, voice-only, hydrated. Voice in through the browser, voice out through Polly with
  per-phrase cache and browser speech as fallback when there are no AWS credentials. English
  by default, Spanish (es-CL) switch; catalog data in the Store's language.
- **Enabled add-ons.** The Simulator starts from a list of Stores, one Bridge URL each,
  mirroring how a Household enables add-ons in Alexa+.
- **Demo household and Synthetic persona.** Bounded Buyer mandate, Test mode or testnet only
  (ADR-0002), fixed synthetic checkout data never logged. Test-mode orders on real Stores need
  a test-order mark from the AgentPOS core; until it exists, only Stores that opted in.
- **Voice overlay in the Bridge.** Voice-ready item data is an overlay in the Bridge's storage,
  confirmed by the Merchant and invalidated by item hash; pushing it into the Store is proposed
  to the core.
- **OAuth 2.0 client credentials.** The Bridge issues bearer tokens from its own token
  endpoint; the Simulator obtains them like Alexa+ would. The static token is for tests only.
- **One trace id.** `Request-Id` (already in the UCP checkout contract) carries the `traceId`
  from Simulator to Bridge to Store; MCP calls carry it in `_meta.traceId`.
- **Merchant console in the Simulator app.** A separate route, importing nothing from the
  Household side, ready to split into `apps/merchant` when it has its own users. The
  onboarding timer starts at a Store that already runs AgentPOS.
- **Household memory behind an interface.** SQLite locally, AgentCore Memory in the hosted
  playground; order references only.
- **Two services on App Runner.** The Bridge has its own public URL because it is "the bridge
  you deploy"; the Simulator is a separate service pointing at it.
- **Fixtures first, docker second.** The skeleton runs on a fictional bakery with physical
  goods shaped by the real AgentPOS OpenAPI, plus recorded responses from the public demo
  Store for shape tests; the same bakery is loaded into the demo-store docker on testnet.

- **Checkout is the host's pattern.** Amazon treats checkout and authentication as standardized
  patterns of the host, so the Simulator renders a native checkout confirmation fed by the UCP
  checkout session. The Bridge contributes the order card and the receipt card afterwards,
  never a checkout view.
- **One Bridge, many Stores.** The Bridge is multi-tenant: `/stores/{slug}/mcp`,
  `/stores/{slug}/checkout-sessions`, `/stores/{slug}/.well-known/ucp`, with a Store registry
  in its SQLite holding only the Store URL and the Voice overlay, never a secret. A Bridge with
  one registered Store behaves like a single-store deployment. `AGENTPOS_STORE_URL` registers
  the first Store at boot.
- **Merchant agents: one interface, two runtimes.** Onboarding, catalog and guardian run
  in-process in the Bridge (Strands TypeScript on Bedrock with the operator's credentials) and
  the same code deploys to AgentCore Runtime for the hosted playground, chosen by environment.
  With no AWS credentials at all, Scenes that need an agent run in Recorded mode and say so on
  screen.

- **Sessions in USD cents, settlement in USDC.** A UCP session needs an ISO 4217 currency and
  integer minor units, and USDC has seven decimals. Sessions are denominated in USD cents, one
  to one with USDC; the conversion is exact or the item is reported unavailable, never rounded.
  The Store's quote in USDC minor units stays the amount that settles.
- **Two UCP releases vendored.** Alexa+ pins 2026-04-08, so sessions and the profile are shaped
  and conformance-tested against that release; 2026-08-25 is vendored for forward reference.
- **Payment rails own the Store call.** The checkout service hands the instrument to the rail
  and never keeps a credential; the session keeps only id, handler and display of the
  instrument that paid. A decline is a 200 with `payment_failed`; a merchant review is a 200
  with `requires_buyer_review`; only protocol errors are 4xx.

## Versions

Pinned in `packages/bridge/src/versions.ts`. MCP spec 2025-11-25 (SDK >= 1.30), UCP checkout
2026-04-08, handlers `dev.ucp.processor_tokenizer` (via the store's `PaymentRail`),
`com.amazon.payments.network_token`, `com.amazon.payments.stored_payment_method`,
`org.x402.stellar`.
