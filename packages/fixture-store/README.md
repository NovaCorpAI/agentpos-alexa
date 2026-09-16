# @agentpos-alexa/fixture-store

A test double of an AgentPOS Store: the same routes and response shapes as the real adapter
(`vendor/agentpos-openapi.json`, version 0.2.0, taken from demo.agentposhq.com on
2026-09-15), with physical goods (a bakery) so the Scenes have something to deliver.

It is not a Store. Nothing settles, receipts are unsigned, the x402 payload is never
verified. Every response that a real Store would sign or settle carries `fixture: true`.

## Run

```bash
pnpm dev:fixture-store      # http://127.0.0.1:8790, UCP profile at /.well-known/ucp
```

Point the Bridge at it with `AGENTPOS_STORE_URL=http://127.0.0.1:8790`.

## What it implements

| Route | Behaviour |
| --- | --- |
| `GET /.well-known/ucp` | profile shaped like the demo store's, `stellar:testnet`, plus a `com.novacorplabs.agentpos_fixture` marker |
| `GET /agentpos/catalog?q=` | eight physical items, integer minor prices (USDC, 7 decimals), attributes with allergens and gluten information |
| `POST /agentpos/cart` | 201 quote with lines, `totalMinor`, `requiresShipping`, policy decision; 400 when a physical item lacks buyer or shipping; 403 when policy refuses |
| `POST /agentpos/checkout?cart=` | 402 with an x402 v2 challenge in `Payment-Required`; with a `Payment-Signature` header: 200 paid, or 202 parked for a human when policy says review; 409 on unknown or expired cart |
| `GET /agentpos/orders/{id}` | order with payment block and `externalOrderId` |
| `GET /agentpos/orders/{id}/receipt` | one unsigned `order.paid` receipt, `verification.mode = fixture` |
| `GET /agentpos/health`, `GET /agentpos/feed` | shaped like the demo store |

## Assumptions the OpenAPI does not settle

- A physical cart without buyer and shipping answers 400 `SHIPPING_REQUIRED` (the OpenAPI lists
  only 201 and 403 for carts).
- The `quote`, `policy`, `agent` and `payment` objects follow what the demo store returns
  today (`recorded/demo-cart-201.json`).
- The "transaction hash" is a digest of the payment payload, prefixed `fixture:`, so that
  idempotency by hash can be exercised.

## Recorded responses

`recorded/` holds real responses from demo.agentposhq.com (profile, catalog, health, a cart
quote and the decoded 402 challenge). Tests check that the store client parses both the
recordings and the fixture, so the fixture cannot drift from the real shapes unnoticed.
