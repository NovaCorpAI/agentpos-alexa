# AgentPOS for Alexa+

**Turn any existing online store into an Alexa+ add-on with in-conversation checkout: MCP
server, UCP checkout, merchant policies and verifiable receipts, with the store as merchant
of record and no marketplace in between. The merchant chooses how to get paid.**

Alexa+ for Builders is for Priceline. AgentPOS is for the corner store.

> Status: early development for the Amazon "Build, Ship, Shape" Developer Hackathon 2026
> (Alexa+ track, AWS Builder and Open Source mini challenges). Public from the first commit.

## What this repository is

Amazon defines an Alexa+ add-on as "the bridge you deploy" between an MCP server and Alexa+.
This repository is that bridge for stores that run [AgentPOS](https://agentposhq.com): it sits
in front of any AgentPOS store, consumes the store's public surfaces (MCP, REST API,
`/.well-known/ucp`, checkout) and exposes the full Alexa+ contract:

- an **MCP server** (Streamable HTTP, spec 2025-11-25) with voice-ready item data and **MCP
  Apps** (product carousel, order card, receipt card with a verified badge);
- the **UCP-compatible checkout** Alexa+ documents: `/checkout-sessions` create, get, update,
  complete and cancel, OAuth 2.0 bearer auth, 24-hour idempotency, 6-hour sessions, business
  errors as `messages[]`;
- **payment rails** behind one interface, chosen by the merchant, never by us:
  1. **the merchant's own PSP** (Stripe, in test mode for the demo): the charge lands in the
     store's dashboard with the store as merchant of record;
  2. **Amazon Wallet** (`com.amazon.payments.network_token`, `stored_payment_method`):
     implemented against the published contract and exercised with a clearly labeled simulated
     PSP while the Alexa+ program is in preview;
  3. **USDC on Stellar** (`org.x402.stellar`) when the agent brings a wallet: real settlement
     through an open x402 facilitator;
- **merchant-side agents** on Amazon Bedrock AgentCore with Strands: onboarding (turns a URL
  into a voice-ready catalog and proposed policies; a human confirms), catalog (answers what a
  flat catalog cannot) and policy guardian (adds context to the store's deterministic policy
  and can hand the order to a human);
- a **simulated Alexa+ client** (`apps/simulator`), the official alternative path for the
  track: an Echo Show style web app, voice in and out, whose agentic client runs on Bedrock
  and drives the bridge end to end.

The store side (catalog, quotes, merchant policies, human approval queue, signed receipt
chain, agent identity, settlement, WooCommerce order creation only after settlement) is
AgentPOS itself. This bridge runs today against the public demo store at
`https://demo.agentposhq.com` and needs nothing else.

## Layout

```
packages/store-client   typed client for the public surfaces of an AgentPOS store (discovery, REST, x402 challenge)
packages/fixture-store  test double of an AgentPOS Store: the real OpenAPI shapes, a bakery with physical goods, recorded demo responses
packages/bridge         the add-on: MCP server for Alexa+, UCP checkout sessions, payment rails, UCP profile
packages/agents         onboarding, catalog and policy guardian agents (Strands on AgentCore, Bedrock)
apps/simulator          simulated Alexa+ experience (Bedrock + Strands client, voice or text)
docs/                   strategy, submission draft, architecture, Alexa+ MCP design rules, security, AWS integration, usage events, friction log
```

## Run

Requirements: Node >= 22.13 (uses `node:sqlite` unflagged, no native dependencies), pnpm 11+.

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm dev:fixture-store # a bakery-shaped test double of an AgentPOS Store on :8790 (optional)
pnpm dev:bridge        # registers AGENTPOS_STORE_URL (default: the public demo store) and listens on :8787
pnpm dev:simulator     # the simulated Alexa+ experience on http://127.0.0.1:8788 (builds its web app first)
```

The simulator needs the same `BRIDGE_BEARER_TOKEN` as the bridge (set it in `.env` for both,
or copy the one-run token the bridge prints). It shows an Echo Show frame with the four
display modes Amazon documents (inline, fullscreen, voice-only, hydrated), the Enabled
add-ons the bridge serves, voice or text input, and an inspection summary per turn
(`.data/inspection-summary.json`) that checks what Amazon's guide asks for: voice text
first, three to five carousel items, first item within 500 ms, typed errors. Until the
Household agent lands, a scripted router with no model maps the text to one Bridge tool.

Checkout is the host's own pattern, as it is in Alexa+: when the customer confirms what to
buy, the simulator opens a UCP checkout session on the bridge, fills the Demo household's
synthetic address, shows the store's quote with the payment handlers the session accepts
(the Amazon handlers, labeled SIMULATED), and completes with the chosen one. The order card
and the receipt card that follow are the bridge's own MCP Apps views (`get_order`,
`get_receipt`).

![The simulator rendering the bridge's carousel view inside an Echo Show frame](docs/assets/simulator-carousel.png)

![The host's checkout pattern with the simulated Amazon handlers](docs/assets/simulator-checkout.png)

To run the bridge against the bakery instead of the public demo store, set
`AGENTPOS_STORE_URL=http://127.0.0.1:8790`.

The MCP endpoint for Alexa+ (or any MCP client) is `/stores/{slug}/mcp`: Streamable HTTP,
spec 2025-11-25, bearer auth. Without `BRIDGE_BEARER_TOKEN` in the environment the bridge
prints a one-run token in its first log line. Four tools, one intent each: `search_items`,
`get_item`, `get_policies`, `start_checkout`. Every result speaks first (a short text block)
and carries structured content with prices as integer minor units. `search_items` and
`get_item` also carry an MCP Apps view (carousel, item card) that the bridge serves as a
`ui://` resource: one self-contained HTML file each, built from `packages/bridge/apps/` with
`pnpm --filter @agentpos-alexa/bridge build:apps` and committed, so nothing needs building
to run.

The UCP checkout Alexa+ documents lives at `/stores/{slug}/checkout-sessions` (create, get,
update, complete, cancel). Sessions are priced from the Store's catalog, quoted by the Store
once a delivery address exists, and completed only when a payment rail reports settlement
with a reference. Idempotency-Key is required on every state change and replayed for 24
hours; every response is validated in tests against the vendored official UCP schemas
(`packages/bridge/vendor/ucp`). Platforms get bearer tokens from `POST /oauth/token` with
client credentials (`BRIDGE_OAUTH_CLIENT_ID` and `BRIDGE_OAUTH_CLIENT_SECRET`).

Then:

```bash
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/stores/demo-agentposhq-com/.well-known/ucp
```

The bridge is multi-tenant: every Store it serves lives under `/stores/{slug}/`, and the
first one is registered at boot from `AGENTPOS_STORE_URL`. Every response carries a
`Request-Id` that is the trace id across the bridge's JSON logs, the Store request and the
settlement. The simulator and the agents land next (see "Build order" in `CLAUDE.md`).
Environment variables are listed in `.env.example`. Nothing in this repository ever holds a
merchant's or a household's private key or PSP secret.

## Principles we do not bend

- The store is merchant of record. No commission, no custody, no marketplace.
- The merchant chooses the rail. The bridge never holds a PSP key; the store executes the charge.
- Nothing scanned is published without human confirmation.
- No order is created without settled payment and a settlement reference.
- Every protocol detail (MCP, UCP, x402) lives behind an adapter and is pinned to a version.
- Amounts are integers in minor units. Never floats for money.
- Cryptography only through official SDKs (`@x402/*`, `@stellar/stellar-sdk`, MCP SDK).

## Strategy

Why the rails are ordered this way, why the simulator comes second and how impact is
measured: `docs/STRATEGY.md`.

## AWS integration

See `docs/AWS-INTEGRATION.md` (services, why each, where in the code).

## Security by design

See `docs/SECURITY.md`.

## Friction log

Written while building, one entry per obstacle with Amazon or AWS tooling:
`docs/FRICTION-LOG.md`.

## License

Apache-2.0. Copyright 2026 NovaCorpAI SpA.
