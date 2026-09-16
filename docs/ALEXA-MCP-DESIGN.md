# Alexa+ MCP design rules we follow

Distilled on 2026-09-15 from Amazon's published add-on guide, which is open without program
access. Every rule here is checked in code review of `packages/bridge/src/mcp/` and
`apps/simulator`. Quotes are verbatim from the pages linked at the end.

## Tools

- "Design each tool to represent one meaningful customer intent." No tools that "duplicate or
  overlap each other's functionality".
- "Give each tool a clear, concise description that states when to call it, why it's used, and
  what it returns."
- "Declare only what you honor." A parameter the server ignores "produces confidently wrong
  answers". Output stays in sync with the declared schema; no undeclared extension fields.
- "The most common source of poor responses is a tool that returns nothing... Always return an
  error response." Our errors are `{ code, message, hint }`.
- "Every tool returned by your server's tools/list endpoint must be invocable, no dead,
  placeholder, or non-functional entries."
- "Ship only your own content: no third-party tracking parameters, or upstream deep links."

Tool set for a store, one intent each: `search_items`, `get_item`, `get_policies`,
`start_checkout` (validates the lines and hands them to the checkout service), `get_order`
and `get_receipt`. Cart, quote, payment and completion go through the UCP checkout
endpoints, which Alexa handles as "standardized patterns so customers always experience a
consistent, familiar flow regardless of which add-on triggers it"; the simulator renders that
pattern natively and never as an add-on view.

## Components and display modes

- **Carousel**: "Return 3 to 5 items in inline mode. Start delivering the first item within
  500ms." Used for search results.
- **Card**: "Use it when one result warrants individual focus." Used for the item detail, the
  order card and the receipt card with the verified badge.
- **List**: shopping lists and similar. Used for the policies summary if needed.
- **Inline** is "the default behavior for any MCP response with a UI payload". **Fullscreen**
  is "the same experience with more room". **Hydrated** (no UI payload): "Alexa renders that
  data through its native interface." **Voice-only**: "Alexa surfaces voice responses
  automatically on devices without a screen." "If a specified mode isn't supported on a given
  device, Alexa falls back to text rendering."
- Consequence: every tool result carries voice-ready text first, and the UI payload second.
  The simulator renders inline, fullscreen and voice-only for each result.

## Protocol

- "Alexa+ for Builders supports the 2025-11-25 version of the MCP specification" over
  Streamable HTTP, plus "the MCP Apps extension, enabling you to render interactive UIs for MCP
  tools directly in the conversation view". Pinned in `packages/bridge/src/versions.ts`.

## Sources

- https://developer.amazon.com/docs/alexaplus/add-ons/mcp-addon-tools-schema-data-design.html
- https://developer.amazon.com/docs/alexaplus/add-ons/mcp-addon-components-and-patterns.html
- https://developer.amazon.com/docs/alexaplus/add-ons/mcp-addon-display-modes.html
- https://developer.amazon.com/docs/alexaplus/add-ons/functional-requirements.html
- https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-certify.html
- https://developer.amazon.com/docs/alexaplus/add-ons/checkout-integration.html
