# Friction log

Written while building, one entry per obstacle with an Amazon or AWS SDK, API, simulator,
console or document. Severity: Blocking (could not proceed), High (hours lost), Medium
(confusion, quick workaround), Low (detail).

Each entry: date, tool, what we tried, what happened (exact error, observed behavior, doc
link), severity, time lost, workaround, concrete suggestion for the Amazon team, link to the
commit or file.

---

## FL-001

- Date: 2026-09-14
- Tool: Alexa+ MCP Toolkit and Alexa+ for Builders
- What we tried: enroll to register a self-hosted MCP add-on from a company account in Chile.
- What happened: the MCP Toolkit overview states "The MCP Toolkit is available in the United
  States" and Alexa+ for Builders is "currently available to select partners working directly
  with our team". No self-serve path found.
- Severity: High (changes the demo strategy)
- Time lost: [fill]
- Workaround: the track rules accept "a simulated Alexa+ experience in a web app using your
  preferred agentic tool"; we build `apps/simulator` with Bedrock and Strands and target the
  same MCP and checkout contracts.
- Suggestion: a sandbox-only enrollment for developers outside the US, gated to the
  simulator, would let global developers validate add-ons before the program opens.
- Link: [commit]
