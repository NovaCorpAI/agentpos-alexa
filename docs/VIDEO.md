# Demo video: shot list

Under three minutes, English, filmed against the hosted playground so a judge can repeat every
shot. Each take is real screen motion at ten frames a second, captured from the page itself:
nothing here is a slide, a mock-up or a re-enactment.

The cut takes the dead air out without ever speeding up what is being shown. A take is three
parts, the typing, the model thinking and the answer landing; only the middle one is
compressed, by exactly as much as it takes for the beat to last as long as its line of
narration.

| # | Take | Screen | Voice over | What the system answers |
| --- | --- | --- | --- | --- |
| 1 | title | Title card | "Alexa Plus for Builders is built for Priceline. This is for the corner store." | |
| 2 | hello | The playground at rest, then: What bread do you have? | "A store, reached the way Alexa Plus reaches one: over MCP, answering from what it publishes." | The carousel of the store's items, spoken back with exact prices |
| 3 | merchant | Merchant console: the store's address, Read it and draft, the stages filling in | "The baker pastes her address. An agent reads her catalog and drafts how each item should sound out loud. Nothing is published until she confirms." | Eight items drafted, every stage timestamped from usage_events |
| 4 | buy | Say: Buy two sourdough loaves | "Buying is a conversation. The checkout is the host's, not a web page." | The checkout card, with the quote read out loud |
| 5 | pay | Confirm with the store's own Stripe, test mode | "Her own Stripe charges the card, in test mode. The bridge never sees the key. The Amazon wallet handlers are simulated, and labeled." | "Order placed. The store charged its Stripe account in test mode, no real money moved." |
| 6 | guardian | Order the same thing again, then answer the guardian | "A guardian checks before any money moves, and the household decides, not the agent." | "Just checking: you ordered 2 Sourdough loaves today, did you mean to order them again?" |
| 7 | cart | Buy one baguette, then: Add a butter croissant | "One cart, item by item, like a person would." | "Added to the cart." One session, both lines, re-quoted by the store |
| 8 | memory | A fresh conversation, then: The same as last week | "Memory holds order references only, on AgentCore Memory. No names, no addresses." | The checkout opens with the same items |
| 9 | history | Say: How much have I spent this month? | "The store answers about its catalog. The host answers about you: what you bought here, and what you have spent this month." | The host's own card: the total, the orders, what the household buys most |
| 10 | spanish | Press ES | "One switch, and the whole thing speaks Spanish. This was built in Chile, for stores like these." | The interface, the assistant and the cards, all in Spanish |
| 11 | end | End card | "A closed checkout session costs a fifth of a cent in inference. Twelve friction log entries, each with the time it cost and a suggestion. Open source from the first commit, and the playground is live." | |

## Lines to record as voice over

Read them flat and fast; the screen carries the detail. They live in `scripts/video-narration.mjs`,
which is what Polly reads, so the two cannot drift.

## The film as it stands (2026-09-21)

`.data/video/agentpos-alexa-demo.mp4`: 2 minutes 17 seconds, 1920 by 1080 at 30 frames a
second, 9 MB, H.264 and AAC, shot against https://alexa.agentposhq.com and narrated by Polly.
Real screen motion, not stills: the typing, the cards arriving, the language switching. Ready
to upload; the previous cut (https://youtu.be/MOxcz6SIt6c) shows the older interface and an
older flow.

Three things came out of watching the takes, and were fixed before the final one: the
assistant was saying markdown asterisks out loud, the first purchase of the film tripped the
guardian because the household had bought the same loaf minutes earlier, and the recorder
drops a take now and then, which the shoot now notices and reshoots by itself.

## Recording it without a camera

Three commands, no screen recorder and no microphone:

```bash
pnpm video:narration   # Amazon Polly (generative Joanna) reads the lines above
pnpm video:shoot       # a real browser plays the demo on the hosted playground, one take per beat
pnpm video:cut         # ffmpeg cuts each take to its line and lays the narration over it
```

The shoot records the page itself, so nothing of the operator's desktop is captured and the
machine stays usable. Each take carries the moment the typing ended and the moment the answer
landed; the cut uses them to fit the beat to its narration. A take that goes wrong is reshot on
its own. Everything lands under `.data/video/`, which is git ignored; the upload to YouTube is
manual.

## Reproducing the shots without speaking

The same sequence runs headless against the public deployment, which is how the lines above
were captured:

```bash
node scripts/demo-run.mjs https://alexa.agentposhq.com
```

It prints every turn, the tools each one called and what the assistant answered, so the voice
over can be checked against the system's own words before recording.
