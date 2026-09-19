# PR Management

**Route:** `/pr-management` · **Sidebar:** GitHub Operations → PR Management

List and filter pull requests across your detection repositories, tracking review state for detection-as-code changes.

## What it does

- View open/closed PRs from your detection repos.
- Filter by repo, author, and state.
- Jump into the PRs that rules from the [Rule Workspace](../engineering/rule-workspace.md), [Detection Packs](../detection/detection-packs.md), and [Reports](reporting.md) create.

## API

`/api/github/prs` (GitHub client: `src/lib/github.ts`, `githubRequest`). Requires `GITHUB_TOKEN`.
