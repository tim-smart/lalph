```
  .--.
 |^()^|  lalph
  '--'
```

A LLM agent orchestrator driven by your chosen source of issues.

## Features

- Pull work from an issue source (GitHub Issues, Linear, etc.) and keep task state in sync
- Projects to group execution settings (enabled state, concurrency, target branch, git flow, review agent)
- Agent presets to control which CLI agent runs tasks, with optional label-based routing
- Plan mode to turn a high-level plan into a spec and generate PRD tasks
- Git worktrees to support multiple concurrent iterations
- Optional PR flow with auto-merge and support for issue dependencies

## Installation

```bash
npm install -g lalph
```

or run with npx:

```bash
npx -y lalph@latest
```

## CLI usage

- Run the main loop across enabled projects: `lalph`
- Run a bounded set of iterations per enabled project: `lalph --iterations 1`
- Configure projects and per-project concurrency: `lalph projects add`
- Inspect and configure agent presets: `lalph agents ls`
- Start plan mode: `lalph plan`
- Create an issue from your editor: `lalph issue`
- Choose your issue source integration (applies to all projects): `lalph source`

It is recommended to add `.lalph/` to your `.gitignore` to avoid committing your
credentials.

## Agent presets

Agent presets define which CLI agent runs tasks (and with what arguments). Lalph
always needs a default preset and will prompt you to create one on first run if
it's missing.

Some issue sources support routing: you can associate a preset with a label, and
issues with that label will run with that preset; anything else uses the default.

```bash
lalph agents ls
lalph agents add
```

## Projects

Projects bundle execution settings for the current repo: whether it is enabled
for runs, how many tasks can run concurrently, which branch to target, what git
flow to use, and whether review is enabled.

`lalph` runs across all enabled projects in parallel; for single-project
commands, you'll be prompted to choose an active project when needed.

```bash
lalph projects add
lalph projects toggle
```

## Plan mode

Plan mode opens an editor so you can write a high-level plan. You can also pass
`--file` / `-f` with a markdown file path to skip the editor. On save (or file
read), lalph generates a specification under `--specs` and then creates PRD
tasks from it.

Use `--dangerous` to skip permission prompts during spec generation, and `--new`
to create a project before starting plan mode.

```bash
lalph plan
lalph plan --file ./my-plan.md
lalph plan tasks .specs/my-spec.md
```

## Creating issues

`lalph issue` opens a new-issue template in your editor. When you save and close
the file, the issue is created in the current issue source.

Anything below the front matter is used as the issue description.

Front matter fields:

- `title`: short issue title
- `priority`: number (0 = none, 1 = urgent, 2 = high, 3 = normal, 4 = low)
- `estimate`: number of points, or `null`
- `blockedBy`: array of issue identifiers
- `autoMerge`: whether to mark this issue for auto-merge when applicable

```bash
lalph issue
lalph i
```

## Development

- Install dependencies: `pnpm install`
- Build the CLI: `pnpm build`
- Run validations: `pnpm check`
