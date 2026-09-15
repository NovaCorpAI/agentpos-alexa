# Domain docs

How the engineering skills consume this repo's domain documentation when exploring the code.

## Layout: single context

- **`CONTEXT.md`** at the repo root: the glossary. Created lazily by `domain-modeling` when the
  first term is resolved. Read it before exploring if it exists; proceed silently if it does not.
- **`docs/ARCHITECTURE.md`**, section "Decisions": the decisions already taken. Read it before
  proposing a change in the same area. New decisions go there unless all three ADR conditions
  hold (hard to reverse, surprising without context, a real trade-off); only then write
  `docs/adr/NNNN-<slug>.md`.
- **`docs/STRATEGY.md`**: product and demo decisions. Not an ADR source; do not contradict it
  silently.
- **`CLAUDE.md`**, section "Hard rules": ten rules that override any design preference. A
  proposal that breaks one stops and asks.

## Use the glossary's vocabulary

When output names a domain concept (issue title, test name, hypothesis, refactor proposal),
use the term as defined in `CONTEXT.md` and avoid the synonyms it lists under `_Avoid_`. If
the concept is missing from the glossary, either the language is being invented (reconsider)
or there is a gap (note it for `domain-modeling`).

## Flag conflicts

If output contradicts a decision in `docs/ARCHITECTURE.md`, an ADR or a hard rule, say so
explicitly instead of overriding it.
