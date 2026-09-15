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

## Versions

Pinned in `packages/bridge/src/versions.ts`. MCP spec 2025-11-25 (SDK >= 1.30), UCP checkout
2026-04-08, handlers `com.stripe.test_mode` (via the store's `PaymentRail`),
`com.amazon.payments.network_token`, `com.amazon.payments.stored_payment_method`,
`org.x402.stellar`.
