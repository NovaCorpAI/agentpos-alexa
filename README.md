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
packages/store-client   typed client for the public surfaces of an AgentPOS store
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
```

The bridge, the simulator and the agents land in that order (see "Build order" in
`CLAUDE.md`); each one adds its `dev` command here the day it runs. Environment variables are
listed in `.env.example`. Nothing in this repository ever holds a merchant's or a household's
private key or PSP secret.

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
