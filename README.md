# lalph

A small CLI that connects to Linear, pulls the next set of unstarted issues into a local PRD file, and runs a selected CLI agent against them. It keeps the PRD and progress log in sync with Linear while you iterate.

## Setup

- Install dependencies: `pnpm install`
- Build the CLI: `pnpm build`
- Add `.lalph/` to `.gitignore` to keep local state private

## CLI usage

- Run the main loop: `npx -y lalph@latest`
- Run multiple iterations with concurrency: `npx -y lalph@latest --iterations 4 --concurrency 2`
- Select a Linear project: `npx -y lalph@latest select-project`
- Select a label filter: `npx -y lalph@latest select-label`
- Select a CLI agent: `npx -y lalph@latest select-agent`

The first run opens a Linear OAuth flow and stores the token locally.

## Generated files

- `.lalph/prd.json`: synced task list pulled from Linear; update task states here.
- `PROGRESS.md`: append-only log of work completed by the agent.
- `.lalph/config`: local key-value store for Linear tokens and user selections.

## Checks

- Type check + format: `pnpm check`
