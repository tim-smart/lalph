```
  .--.
 | () |  lalph
  '--'
```

A LLM agent orchestrator driven by your chosen source of issues.

## Features

- Integrate with various issue sources (GitHub Issues, Linear, etc.)
- Plan mode to generate issues from high-level goals
- Uses git worktrees to allow for multiple concurrent iterations
- Creates pull requests for each task, with optional auto-merge for vibe coding
- Support issue dependencies to ensure correct task order

## Installation

```bash
npm install -g lalph
```

or run with npx:

```bash
npx -y lalph@latest
```

## CLI usage

- Run the main loop: `lalph`
- Run multiple iterations with concurrency: `lalph --iterations 4 --concurrency 2`
- Start plan mode: `lalph plan`
- Start plan mode without permission prompts: `lalph plan --dangerous`
- Choose your issue source: `lalph source`

It is recommended to add `.lalph/` to your `.gitignore` to avoid committing your
credentials.

## The `.lalph/` Directory

The `.lalph/` directory is the runtime state directory for lalph. It contains
configuration and state files used during orchestration.

### What is `.lalph/prd.yml`?

The `prd.yml` file (Product Requirements Document) is a YAML file containing the
local list of tasks/issues that lalph manages. It serves as the "source of
truth" for the CLI about what work is available and syncs bidirectionally with
remote issue sources like GitHub Issues or Linear.

### Why does it exist?

- **Local tracking**: Allows tracking issue state while working offline or
  between sync cycles
- **Orchestration**: Enables the orchestrator to manage multiple concurrent
  tasks across git worktrees
- **Abstraction**: Provides a consistent interface regardless of the remote
  issue source

### Why would an AI agent be reading it?

If you're an AI agent being orchestrated by lalph, you're reading the prd.yml
file to:

- Understand your current task assignment
- Update task state (`in-progress`, `in-review`, `done`)
- Add new tasks discovered during implementation
- Record blockers or dependencies between tasks
- Leave notes for future work sessions

### File format

```yaml
- id: LALF-2
  title: Issue Title
  description: Explain what this is and why you're reading it.
  priority: 3 # 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low
  estimate: null # Story points (1 point ≈ 1 hour)
  state: in-progress # backlog | todo | in-progress | in-review | done
  blockedBy: [] # Array of issue IDs that must complete first
  autoMerge: false # Whether to auto-merge when complete
```

### Key behaviors

- **Creating tasks**: Set `id: null` to create a new issue that will sync to
  the remote source
- **Automatic sync**: Changes are synced to the remote issue source
  periodically (the file is watched for changes)
- **Semaphore control**: Only one sync runs at a time to prevent conflicts
- **Wait between edits**: Allow ~5 seconds between edits for the system to
  process changes

### Other files in `.lalph/`

- `task.json` - Tracks the current task being worked on in this worktree
- `instructions.md` - Agent-specific instructions generated for the current
  task

> **Note**: Add `.lalph/` to your `.gitignore` to avoid committing runtime
> state and credentials.

## Development

- Install dependencies: `pnpm install`
- Build the CLI: `pnpm build`
