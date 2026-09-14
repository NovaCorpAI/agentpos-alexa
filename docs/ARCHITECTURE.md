# Architecture

```
Alexa+ (preview, US partners)      |   apps/simulator (Bedrock + Strands client, official alternative path)
        \                          |          /
         MCP Streamable HTTP 2025-11-25 + MCP Apps   |   UCP checkout 2026-04-08 (REST, OAuth 2.0)
                                   v
        packages/bridge  (the add-on: Hono, Node 22.5, node:sqlite)
          |-- mcp/            MCP server for Alexa+: voice-ready item data, carousel, order card with verified-receipt badge
          |-- checkout/       checkout-sessions: create, get, update, complete, cancel; 24 h idempotency; 6 h TTL; messages[]
          |-- rails/          org.x402.stellar (real) | com.amazon.payments.* (contract-complete, simulated PSP, labeled)
          |-- profile/        /.well-known/ucp with dev.ucp.shopping and payment handlers
          |-- storage/        sessions, idempotency keys, usage_events
                                   v
        packages/store-client  ->  any AgentPOS store: /agentpos/mcp, REST (items, cart, quote, x402 checkout),
                                   /.well-known/ucp, merchant policy, human approval queue, signed receipts
                                   (demo.agentposhq.com on mainnet; AgentPOS demo-store docker on testnet)
                                   v
        packages/agents (Strands Agents SDK on Bedrock AgentCore Runtime, us-east-1)
          |-- onboarding  (strong model, once per store; human confirms)
          |-- catalog     (Nova 2 Lite, frequent)
          |-- guardian    (strong model, only at completion)
          |-- AgentCore Memory (per-store preferences)
```

## Decisions

- **A bridge, not a fork.** The store keeps running AgentPOS unchanged; the add-on consumes
  its public surfaces. That is Amazon's own definition of an add-on, and it means a judge can
  run this today against the public demo store.
- **Merchant side, not household side.** Alexa+ is the household's agent and Amazon Wallet is
  its wallet. Our value is making the long tail of stores safely reachable.
- **One checkout, five surfaces.** The UCP checkout the bridge serves for Alexa+ is the same
  contract Google AI Mode, Gemini, Copilot Checkout and YouTube Shopping consume.
- **Pluggable payment rails.** x402 on Stellar is live. The Amazon Wallet handlers are
  implemented against the published contract and exercised with a simulated PSP, labeled as
  such, because the Alexa+ program is in preview. The merchant's own PSP comes next.
- **SQLite by default.** No services to create. Postgres for the hosted tier.
- **Testnet for reproducibility, mainnet for the video.** Judges run against the docker demo
  store on testnet; one real mainnet purchase is recorded against the authorized demo store.
- **Upstream what belongs upstream.** A `PaymentRail` interface and native UCP checkout are
  contributed to the AgentPOS core once its repository is public.

## Versions

Pinned in `packages/bridge/src/versions.ts`. MCP spec 2025-11-25 (SDK >= 1.30), UCP checkout
2026-04-08, handlers `org.x402.stellar`, `com.amazon.payments.network_token`,
`com.amazon.payments.stored_payment_method`.
