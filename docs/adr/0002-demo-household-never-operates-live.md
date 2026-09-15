---
status: accepted
date: 2026-09-15
---

# The Demo household never operates on a Live rail

The Demo household the Simulator lends to judges and visitors carries a bounded Buyer
mandate and can only complete checkouts on Test mode rails or on the testnet demo-store
docker. It is refused on Live rails by construction, not by configuration, even though the
public demo Store settles USDC on Stellar mainnet. We chose this over a small mainnet
allowance because a public playground spending our real funds on strangers' purchases is
unbounded risk for a metric we can obtain in Test mode, and hard rule 8 makes mainnet an
explicit, founder-confirmed act. Live purchases in the playground happen only when a visitor
brings their own Buyer mandate and wallet; the recorded mainnet purchase for the video is a
separate, confirmed run.
