# Agent skills

Project-local skills for Claude Code (and any agent that reads `.claude/skills/`). They are
versioned with the code so every clone gets the same working discipline.

## Origin

Ten skills copied from https://github.com/mattpocock/skills at commit
`959a8e9f1edc3adbe2f7e3054bb6fbefa6696260` (2026-09-15), MIT license, see
`LICENSE-mattpocock-skills`. The Codex descriptors (`agents/openai.yaml`) were not copied. The
rest of the upstream collection (triage, wayfinder, code-review, implement, to-spec,
prototype, teach and others) was left out on purpose: either it duplicates what Claude Code
already provides or it targets larger codebases with inbound issues.

| Skill | Why it is here |
| --- | --- |
| `grill-with-docs`, `grilling`, `domain-modeling` | interview before building; keep the glossary in `CONTEXT.md` (checkout session, cart, quote, order, handler, rail, simulated, real, mandate) |
| `tdd` | red then green at agreed seams: UCP endpoints, MCP tools, store client |
| `codebase-design` | vocabulary `tdd` refers to when a module boundary is in question |
| `diagnosing-bugs` | build a red-capable loop before theorizing |
| `research` | primary-source research written as a cited Markdown file, feeds `docs/FRICTION-LOG.md` |
| `to-tickets` | turn the build order into tracer-bullet GitHub issues with blocking edges |
| `wizard` | bash wizards for steps only a human can do: AWS credentials, Stripe test keys in the store, CI secrets |
| `handoff` | compact a session for the next one |

The upstream setup skill was run by hand: its output lives in `docs/agents/` and in the
"Agent skills" section of `CLAUDE.md`.

## Updating

Fetch the same paths from upstream at a newer commit, diff, and record the new commit here.
No em dashes; upstream removed them repo-wide, keep it that way when editing.
