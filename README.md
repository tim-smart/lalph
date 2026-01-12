# Lalph

Lalph is a small CLI wrapper that drives the `opencode-ai` agent against Linear issues. It pulls tasks into `.lalph/prd.json`, runs the agent with a prebuilt prompt, and writes progress back to `.lalph/progress.md`.

## Requirements

- Node.js (ESM support)
- `pnpm` (repo uses `pnpm-lock.yaml`)
- A Linear account with permission to read/write issues

## Setup

```sh
pnpm install
pnpm tsdown src/cli.ts --outDir dist
```

The first run starts a local callback server on port `34338` to complete the Linear OAuth flow. The token is cached in `.lalph/config`.

## Usage

```sh
node dist/cli.js select-project
node dist/cli.js select-label
node dist/cli.js --iterations 2
```

`select-project` also asks you to pick a team for new issues. Running the root command launches the agent and keeps `.lalph/prd.json` in sync with Linear.

## Project Files

- `.lalph/prd.json`: task list synced with Linear
- `.lalph/progress.md`: appended agent progress notes
- `.lalph/config`: persisted settings and Linear access token
