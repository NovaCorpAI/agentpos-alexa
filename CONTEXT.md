# AgentPOS for Alexa+

The bridge between an AgentPOS store and Alexa+ (or its simulated client), plus the merchant
agents around it. This glossary fixes the words; decisions live in `docs/ARCHITECTURE.md`.

## Language

### Parties

**Store**:
An online shop that runs AgentPOS. It is the merchant of record and the source of truth for
catalog, prices, policies and orders.
_Avoid_: merchant (when meaning the shop), shop, vendor, tenant

**Merchant**:
The human who owns a Store and confirms what the onboarding agent drafts.
_Avoid_: store owner, admin

**Household**:
The Alexa+ user who talks to the assistant and buys. Alexa+ is the Household's agent; it is
never our user.
_Avoid_: customer, buyer, user, end user

**Demo household**:
A Household identity the simulator lends to judges and visitors, with a bounded Buyer mandate,
usable only against Test mode or testnet Stores.
_Avoid_: guest, anonymous user

**Bridge**:
This add-on: the service deployed in front of a Store that exposes the Alexa+ contract.
_Avoid_: adapter, gateway, proxy, connector

**Simulator**:
The Echo Show style web app whose agent plays Alexa+ and talks only to Bridges.
_Avoid_: playground (as a synonym), demo app, client

### Payments

**Payment handler**:
A payment method a Store advertises in its UCP profile and that Alexa+ selects, identified by
a reverse-domain id such as `dev.ucp.processor_tokenizer`.
_Avoid_: payment method, PSP (when meaning the handler)

**Rail**:
The Bridge's internal implementation that executes one Payment handler through the Store.
_Avoid_: handler (when meaning the implementation), provider, integration

**Live**:
A Rail that moves real money.
_Avoid_: production, real (alone), mainnet (unless naming the Stellar network)

**Test mode**:
A Rail backed by a real payment processor using its test credentials. No money moves; the
charge is visible in the processor's test dashboard.
_Avoid_: sandbox, staging, fake

**Simulated**:
A Rail backed by a fake processor we wrote because the real one is not reachable. Always
labeled as such in code, logs, responses and UI. Never counted as a purchase.
_Avoid_: mocked, stubbed, emulated

**Buyer mandate**:
The limits a Household set for what its agent may spend, carried by `@agentpos/mcp-buyer`.
_Avoid_: allowance, budget, wallet limit

### Conversation

**Scene**:
A scripted, deterministic run of the Simulator with prerecorded Household inputs, using the
real agent and a real Bridge. The unit of demo and of the video.
_Avoid_: script, demo, flow, scenario (when meaning a Scene)

**Free mode**:
The Simulator with live Household input, voice or text.
_Avoid_: chat mode, interactive mode

**Enabled add-on**:
A Store the Household has turned on in the Simulator, one Bridge URL each.
_Avoid_: connected store, integration, skill

**Merchant console**:
The route of the Simulator app where a Merchant runs onboarding: pastes a Store URL, reviews
the draft and confirms. Merchant-side; shares nothing with the Household side.
_Avoid_: admin, dashboard, backoffice

**Inspection summary**:
The report the Simulator emits per Scene: per tool call, the component rendered, the display
mode, the latency to the first carousel item, the voice text length and whether the tool
returned a typed error. Our stand-in for Amazon's Local Inspector.
_Avoid_: certification verdict, report (alone), audit

**Voice overlay**:
Per Store and per item, the pronounceable name, one-sentence summary and synonyms that the
onboarding agent drafts and the Merchant confirms. Kept by the Bridge, never written to the
Store, invalidated when the item changes in the Store.
_Avoid_: voice catalog, enriched catalog, metadata

**Synthetic persona**:
The fixed name, email and address the Demo household presents at checkout. Never logged.
_Avoid_: test user, dummy data, fake customer

**Recorded mode**:
A Scene running with prerecorded agent responses because no AWS credentials are present.
Always announced on screen; never used for a metric.
_Avoid_: offline mode, mock mode, replay
