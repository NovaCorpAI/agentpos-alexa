---
status: accepted
date: 2026-09-15
---

# The Simulator talks only to the Bridge

The Simulator plays Alexa+. It reaches a Store exclusively through that Store's Bridge, over
the same MCP and UCP checkout surface Alexa+ would use, and it never knows the Store's URL.
We chose this over calling the Store's REST directly (faster to build, richer data) because
the whole point of the demo is proving the add-on contract; a shortcut would make the video
show something Alexa+ could not do. Consequence: any capability the Simulator needs must
first exist as a Bridge tool or checkout field, which is the right pressure.
