# Demo video: shot list

Under three minutes, English, recorded from the hosted playground so a judge can repeat every
shot. Each row gives what to do on screen, what is said, and the lines the system answers,
copied from verified runs on 2026-09-17 and 2026-09-18. Nothing here is a mock-up.

Set up before recording: browser at 1440 by 900, dark theme, Echo Show 8 frame, voice on
(Amazon Polly), Stripe dashboard open in a second tab in test mode, and a terminal with
`pnpm --filter @agentpos-alexa/bridge usage:export --summary` ready for the last shot.

| # | Time | Screen | Voice over | What the system answers |
| --- | --- | --- | --- | --- |
| 1 | 0:00 | Title card over the Echo Show frame | "Alexa Plus for Builders is built for Priceline. This is for the corner store." | |
| 2 | 0:08 | Merchant console (`/#/merchant`), paste the store URL, press Scan and draft | "A baker pastes her store address. The onboarding agent reads the catalog and drafts how each item should sound out loud." | Draft of 8 items in about 7 seconds. "Welcome to Sourdough and Co. Bakery, where you can order freshly baked breads and pastries online." |
| 3 | 0:25 | Edit one spoken name, add the synonym "masa madre", press Confirm and publish | "She corrects one name, adds what her customers actually say, and confirms. Nothing is published until she does." | Status turns to published, stage timeline fills in |
| 4 | 0:40 | Simulator, say: What bread do you have? | "Now the household side." | Carousel of five items, spoken first: "I found these breads: Sourdough loaf, 6.5 USDC; Baguette, 2.8 USDC; Gluten free seeded loaf, 7.8 USDC, and 2 more." |
| 5 | 0:55 | Say: Is the seeded loaf gluten free? Then: Is it organic? | "The catalog agent answers from what the store published, and says so when it has not." | "Yes, Gluten free seeded loaf is gluten free." Then: "The store has not published whether the gluten free seeded loaf is organic." |
| 6 | 1:15 | Say: Buy one baguette. Point at the payment list | "The merchant chooses how to get paid. Her own Stripe comes first, in test mode. The Amazon wallet handlers are simulated and labeled." | "1 Baguette. Your total is $2.80 delivered to 1 Fixture Street. Shall I pay with your Card through the store's Stripe, test card 4242, in test mode?" |
| 7 | 1:30 | Confirm, then switch to the Stripe tab and refresh | "The store charges with its own key. The bridge never sees it." | "Order placed. The store charged its Stripe account in test mode, no real money moved." Stripe shows the payment, for example pi_3UHAgk375U7THQYH |
| 8 | 1:45 | Back in the simulator, say: Buy one baguette again | "The guardian checks before any money moves." | "Just to confirm, you already ordered a Baguette about a minute ago today so did you mean to order another one?" |
| 9 | 1:55 | Say: Yes, order it again | "The household decides, not the agent." | "Order placed." |
| 10 | 2:05 | New conversation, say: The same as last week | "Memory holds order references only, on AgentCore Memory. No names, no addresses." | Checkout opens with the same item and quantity |
| 11 | 2:20 | Terminal with the usage export summary, then the costs table | "Every model call is recorded. A closed checkout session costs a fifth of a cent in inference, prompt caching included." | `costPerClosedSessionUsdMicros: 1818` |
| 12 | 2:35 | The friction log scrolling | "Eleven obstacles with Amazon and AWS tooling, each with the time it cost and a concrete suggestion." | |
| 13 | 2:45 | Repository page, Apache-2.0, the public URL | "Open source from the first commit. The playground is live." | |

## Lines to record as voice over

Read them flat and fast; the screen carries the detail.

1. Alexa Plus for Builders is built for Priceline. This is for the corner store.
2. A baker pastes her store address. The onboarding agent reads the catalog and drafts how each item should sound out loud.
3. She corrects one name, adds what her customers actually say, and confirms. Nothing is published until she does.
4. Now the household side.
5. The catalog agent answers from what the store published, and says so when it has not.
6. The merchant chooses how to get paid. Her own Stripe comes first, in test mode. The Amazon wallet handlers are simulated and labeled.
7. The store charges with its own key. The bridge never sees it.
8. The guardian checks before any money moves.
9. The household decides, not the agent.
10. Memory holds order references only, on AgentCore Memory. No names, no addresses.
11. Every model call is recorded. A closed checkout session costs a fifth of a cent in inference, prompt caching included.
12. Eleven obstacles with Amazon and AWS tooling, each with the time it cost and a concrete suggestion.
13. Open source from the first commit. The playground is live.

## The film as it stands (2026-09-19)

Published: https://youtu.be/MOxcz6SIt6c (channel @Agent-Pos, "agentpos alexa demo").

`.data/video/agentpos-alexa-demo.mp4`: 2 minutes 39 seconds, 1280 by 720, 3 MB, H.264 and AAC,
filmed against the hosted playground and narrated by Polly. Ready to upload; nothing about it
is staged. Two fixes came out of watching it: a visitor can now play every Scene without
hitting the turn cap, and Scene 4 starts a fresh conversation so the recall is visibly memory.

## Recording it without a camera

Three commands, no screen recorder and no microphone:

```bash
pnpm video:narration   # Amazon Polly (generative Joanna) reads the lines above, 30 s of speech
pnpm video:record      # a real browser plays the demo on the hosted playground, captured to WebM
pnpm video:build       # ffmpeg lays the narration on the screen capture, H.264 and AAC for YouTube
```

The recorder holds each shot for as long as its line takes to say plus a pause, and the build
places the audio at those same moments, so picture and voice line up without hand editing.
Everything lands under `.data/video/`, which is git ignored; the upload to YouTube is manual.

## Reproducing the shots without speaking

The same sequence runs headless against the public deployment, which is how the lines above
were captured:

```bash
node scripts/demo-run.mjs https://ag-7e67cc0a076f402c969b806381d31b43.ecs.us-east-1.on.aws
```

It prints every turn, the tools each one called and what the assistant answered, so the voice
over can be checked against the system's own words before recording.
