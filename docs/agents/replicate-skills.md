# Replicating the agent skills in another NovaCorpAI repository

Paste the block below as the first message of a Claude Code session opened in the target
repository (for example `agentpos-doorstep`). It reproduces what `agentpos-alexa` did on
2026-09-15: ten project-local skills copied from `mattpocock/skills` at a pinned commit, the
setup applied by hand, and the pointers in `CLAUDE.md`.

---

Set up project-local agent skills in this repository, replicating what NovaCorpAI/agentpos-alexa already has. Do it in one pass, then show me the file list and the diff of CLAUDE.md before committing. Do not install any Claude Code plugin; the skills must live as files in this repo.

1. Source. Copy these ten skill folders into `.claude/skills/` at the repo root, one folder per skill, keeping every file except `agents/openai.yaml` (Codex descriptors):
   grill-with-docs, grilling, domain-modeling, tdd, codebase-design, diagnosing-bugs, research, to-tickets, wizard, handoff.
   Preferred source: the sibling checkout of agentpos-alexa on this machine (`../agentpos-alexa/.claude/skills/`), which already excludes the Codex files and includes `LICENSE-mattpocock-skills` and a README. If it is not present, fetch the same folders from https://github.com/mattpocock/skills at commit 959a8e9f1edc3adbe2f7e3054bb6fbefa6696260 (`skills/engineering/<name>` and `skills/productivity/<name>`), plus the repository LICENSE saved as `.claude/skills/LICENSE-mattpocock-skills`. Do not copy `setup-matt-pocock-skills`, `triage`, `wayfinder`, `code-review`, `implement`, `to-spec`, `prototype`, `improve-codebase-architecture`, `teach`, `wait-what`, `ask-matt`, `to-questionnaire`, `writing-for-agents`.

2. Attribution. Write `.claude/skills/README.md` stating: origin repository, the pinned commit, MIT license (file next to it), which skills were copied and why in a short table, which were left out on purpose, and how to update (fetch the same paths at a newer commit, diff, record the commit). No em dashes anywhere.

3. Setup by hand (the upstream setup skill is not copied). Create:
   - `docs/agents/issue-tracker.md`: GitHub Issues in this repository through the `gh` CLI, with the conventions for create, read, list, comment, label and close, and the note that `to-tickets` uses native issue dependencies (`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker database id>`, where the id comes from `gh api repos/<owner>/<repo>/issues/<n> --jq .id`), falling back to a `Blocked by: #n` line in the body. State that the `triage` skill is not installed and PRs are not a triage surface.
   - `docs/agents/domain.md`: single context. `CONTEXT.md` at the repo root is the glossary, created lazily by `domain-modeling` when the first term is resolved; existing decisions live in the project's architecture document (name the file this repo actually uses); ADRs go to `docs/adr/NNNN-slug.md` only when all three conditions hold (hard to reverse, surprising without context, a real trade-off); the hard rules in `CLAUDE.md` override any design preference; conflicts are flagged, never silently overridden.

4. `CLAUDE.md`. If it exists, append this section (adapt the file names to this repo); if it does not exist, create it with the repository's purpose first and this section last:

   ## Agent skills
   Project-local skills live in `.claude/skills/` (origin and rationale in `.claude/skills/README.md`). Use `/grill-with-docs` before designing a module, `tdd` at agreed seams while building, `research` for anything that needs primary sources, and `/to-tickets` to turn a plan into GitHub issues.
   ### Issue tracker
   GitHub Issues in this repo, through the `gh` CLI. See `docs/agents/issue-tracker.md`.
   ### Domain docs
   Single context: `CONTEXT.md` at the root for the glossary, decisions in <architecture file>, ADRs only when warranted. See `docs/agents/domain.md`.

5. Hygiene. Add `.claude/settings.local.json` to `.gitignore`. Verify: every `SKILL.md` has a `name:` in its frontmatter matching its folder; no CRLF line endings; no em dashes in anything you wrote; the ten folders plus the license and README are present. Show me the file list and the CLAUDE.md diff, then commit as `chore: add project-local agent skills from mattpocock/skills` with a body naming the pinned commit and the license.

6. First use. After the commit, suggest running `/grill-with-docs` on the module with the most open design decisions in this repo, and say which one you think that is.

---

What differs per repository: the architecture file name in step 3 and 4, and the project purpose if `CLAUDE.md` is new. Everything else is identical, so the three NovaCorpAI hackathon repositories share one working discipline.
