# lalph

A small CLI that connects to Linear, pulls the next set of unstarted issues into a local PRD file, and runs a selected CLI agent against them. It keeps the PRD and progress log in sync with Linear while you iterate.

## Setup

- Install dependencies: `pnpm install`
- Build the CLI: `pnpm exec tsc`

## CLI usage

- Run the main loop: `node dist/cli.js`
- Select a Linear project: `node dist/cli.js select-project`
- Select a label filter: `node dist/cli.js select-label`
- Select a CLI agent: `node dist/cli.js select-agent`

The first run opens a Linear OAuth flow and stores the token locally.

## Generated files

- `.lalph/prd.json`: synced task list pulled from Linear; update task states here.
- `PROGRESS.md`: append-only log of work completed by the agent.
- `.lalph/config`: local key-value store for Linear tokens and user selections.

## Checks

- Type check: `pnpm exec tsc --noEmit`
- Format check: `pnpm exec prettier --check .`
