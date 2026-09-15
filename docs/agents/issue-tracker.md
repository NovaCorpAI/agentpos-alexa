# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues in `NovaCorpAI/agentpos-alexa`. Use the
`gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments` with `--label` and `--state` filters as needed.
- **Comment on an issue**: `gh issue comment <number> --body "..."`.
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`.
- **Close**: `gh issue close <number> --comment "..."`.

Infer the repo from `git remote -v`; `gh` does this automatically inside a clone.

## Pull requests as a triage surface

**PRs as a request surface: no.** The `triage` skill is not installed.

## When a skill says "publish to the issue tracker"

Create a GitHub issue. Tickets from `to-tickets` use native issue dependencies for blocking
edges (`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`,
where the id is the blocker's numeric database id from `gh api repos/<owner>/<repo>/issues/<n> --jq .id`).
Where dependencies are not available, put a `Blocked by: #<n>` line at the top of the body.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.
