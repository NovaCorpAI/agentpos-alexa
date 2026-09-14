# Security by design

- **Nothing here holds keys or funds.** The bridge never stores a merchant's or a household's
  private key. Payments go from the buyer's wallet to the merchant's wallet through an open
  x402 facilitator; the bridge only relays the signed payment payload the store's checkout
  expects.
- **The store is the source of truth.** Cart, price, tax, inventory and fulfillment are
  computed by the store. The bridge translates protocol shapes; it does not decide money.
- **No order without settlement.** `complete` succeeds only after the store reports a settled
  payment with a transaction hash. Idempotent by transaction hash and by `Idempotency-Key`.
- **Simulated means labeled.** The Amazon payment handlers run against a simulated PSP while
  the Alexa+ program is in preview. The simulation is named in code, logs, responses and UI.
  It can never be switched to a real PSP by configuration alone.
- **Auth at every edge.** OAuth 2.0 bearer on checkout sessions (401 on failure), bearer on
  the MCP endpoint, HMAC or bearer on webhooks from stores.
- **Inputs are validated at the boundary** with schemas; bodies are size-limited; rate limits
  answer 429 with `Retry-After`.
- **Logs carry no PII.** Structured JSON with a `traceId`; addresses and emails are never
  logged.
- **Secrets only in the environment.** `.env.example` is always current; the git history is
  scanned for leaks before every release.
- **Mainnet is opt-in twice.** An explicit flag and the founder's explicit confirmation, and
  only against the already authorized demo store.
