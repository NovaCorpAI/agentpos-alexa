# AgentPOS for Alexa+

**Turn any existing online store into an Alexa+ add-on with in-conversation checkout: MCP
server, UCP checkout, merchant policies and verifiable receipts, with the store as merchant
of record and no marketplace in between.**

Alexa+ for Builders is for Priceline. AgentPOS is for the corner store.

> Status: early development for the Amazon "Build, Ship, Shape" Developer Hackathon 2026
> (Alexa+ track, AWS Builder and Open Source mini challenges). Public from the first commit.

## What this repository is

Amazon defines an Alexa+ add-on as "the bridge you deploy" between an MCP server and Alexa+.
This repository is that bridge for stores that run [AgentPOS](https://agentposhq.com): it sits
in front of any AgentPOS store, consumes the store's public surfaces (MCP, REST API,
`/.well-known/ucp`, x402 checkout) and exposes the full Alexa+ contract:

- an **MCP server** (Streamable HTTP, spec 2025-11-25) with voice-ready item data and **MCP
  Apps** (product carousel, order card with a verified-receipt badge);
- the **UCP-compatible checkout** Alexa+ documents: `/checkout-sessions` create, get, update,
  complete and cancel, OAuth 2.0 bearer auth, 24-hour idempotency, 6-hour sessions, business
  errors as `messages[]`;
- **payment rails** behind one interface: `org.x402.stellar` (real settlement in USDC on
  Stellar through an open facilitator) and the Amazon Wallet handlers
  (`com.amazon.payments.network_token`, `stored_payment_method`) implemented against the
  published contract and exercised with a clearly labeled simulated PSP while the Alexa+
  program is in preview;
- **merchant-side agents** on Amazon Bedrock AgentCore with Strands: onboarding (turns a URL
  into a voice-ready catalog and proposed policies; a human confirms), catalog (answers what a
  flat catalog cannot) and policy guardian (adds context to the store's deterministic policy
  and can hand the order to a human);
- a **simulated Alexa+ client** (`apps/simulator`), the official alternative path for the
  track: a web app whose agentic client runs on Bedrock and drives the bridge end to end.

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
docs/                   architecture, security by design, AWS integration, friction log
```

## Run

Requirements: Node >= 22.5 (uses `node:sqlite`, no native dependencies), pnpm 11+.

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm --filter @agentpos-alexa/bridge dev -- --store https://demo.agentposhq.com
```

Environment variables are listed in `.env.example`. Nothing in this repository ever holds a
merchant's or a household's private key.

## Principles we do not bend

- The store is merchant of record. No commission, no custody, no marketplace.
- Nothing scanned is published without human confirmation.
- No order is created without settled payment and a transaction hash.
- Every protocol detail (MCP, UCP, x402) lives behind an adapter and is pinned to a version.
- Amounts are integers in minor units. Never floats for money.
- Cryptography only through official SDKs (`@x402/*`, `@stellar/stellar-sdk`, MCP SDK).

## AWS integration

See `docs/AWS-INTEGRATION.md` (services, why each, where in the code).

## Security by design

See `docs/SECURITY.md`.

## Friction log

Written while building, one entry per obstacle with Amazon or AWS tooling:
`docs/FRICTION-LOG.md`.

## License

Apache-2.0. Copyright 2026 NovaCorpAI SpA.
