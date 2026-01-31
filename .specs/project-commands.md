# Project Commands Research

## Summary

Add a first-class "project" concept to the CLI so multiple project configurations
can run concurrently. Projects encapsulate issue source settings and execution
options (target branch, git flow mode, review mode, concurrency), removing those
settings from top-level flags. The CLI ships with a "default" project enabled.

## Goals

- Provide project subcommands: add, rm, ls, disable, enable.
- Persist per-project issue source settings and execution options.
- Run the main loop for every enabled project concurrently.
- Require project selection for plan mode and issue creation.
- Remove target branch, git flow mode, review mode, and concurrency from CLI flags.

## Non-Goals

- No changes to core issue source APIs beyond configuration scoping.
- No new UI outside the CLI prompts.
- No changes to PRD task format or prd.yml semantics.

## Current Architecture Notes

- Settings are stored via `Settings` + `Setting` using a KeyValueStore at
  `.lalph/config` (`src/Settings.ts`, `src/Kvs.ts`). Settings keys are plain
  strings (e.g. `issueSource`, `linear.selectedProjectId`).
- `IssueSources` tracks the selected issue source and exposes
  `CurrentIssueSource.layer` (`src/IssueSources.ts`).
- Linear/GitHub issue sources keep selection state in Settings
  (`src/Linear.ts`, `src/Github.ts`).
- The root command owns flags for `--concurrency`, `--target-branch`, `--review`
  and uses them in `src/commands/root.ts`.
- `plan` and `issue` use `CurrentIssueSource.layer` and should prompt for a
  project after this change (`src/commands/plan.ts`, `src/commands/issue.ts`).

## Proposed Design

### Project Model

Each project stores:

- `id`: string key (used in settings prefixes and CLI selection).
- `name`: display name.
- `enabled`: boolean.
- `issueSourceId`: "linear" | "github" (future sources possible).
- `issueSourceSettings`: per-source settings (scoped by project).
- `targetBranch`: string | null.
- `gitFlowMode`: "pr" | "commit".
- `review`: boolean.
- `concurrency`: number (>= 1).

Default project:

- Create an initial "default" project on first run if none exist.
- Migrate existing global settings into the default project (see Migration).

### Storage

Use Settings with project-scoped keys. Example key layout:

- `projects.list`: Array of project ids.
- `projects.{id}.name`
- `projects.{id}.enabled`
- `projects.{id}.issueSourceId`
- `projects.{id}.targetBranch`
- `projects.{id}.gitFlowMode`
- `projects.{id}.review`
- `projects.{id}.concurrency`

Issue source settings become scoped by project id, for example:

- `projects.{id}.issueSource.issueSource`
- `projects.{id}.issueSource.linear.selectedProjectId`
- `projects.{id}.issueSource.linear.selectedTeamId`
- `projects.{id}.issueSource.linear.selectedLabelId`
- `projects.{id}.issueSource.linear.selectedAutoMergeLabelId`
- `projects.{id}.issueSource.github.labelFilter`
- `projects.{id}.issueSource.github.autoMergeLabel`

This keeps persistence in the same `.lalph/config` backend while isolating
project settings.

### Migration

On startup, if no `projects.list` exists:

1. Create a `default` project.
2. Read existing global settings (`issueSource`, Linear/GitHub selection keys,
   and any default flags if stored elsewhere).
3. Write them into the default project's scoped keys.
4. Clear or ignore the old global keys to prevent future reads.

### CLI Changes

- Add `project` command with subcommands:
  - `project ls`: list projects with enabled/disabled and key settings.
  - `project add`: prompt for name/id, issue source, and per-project options.
  - `project rm`: remove project by id (confirm).
  - `project enable`: enable a project.
  - `project disable`: disable a project.
- Add project selection prompt for `plan` and `issue` commands.
- Remove flags from root command:
  - `--target-branch`
  - `--review`
  - `--concurrency`
  - git flow mode flag (currently `--commit` / PR default).

### Main Loop Concurrency

- Load enabled projects once per run.
- For each enabled project, spawn a worker loop with that project's settings.
- Each project uses its own concurrency level (semaphore per project).
- Ensure project workers use project-scoped `CurrentIssueSource` + settings.

### Issue Source Scoping

- Introduce a `ProjectContext` (or similar) service that provides the current
  project id and settings prefix.
- Refactor `IssueSources` and Linear/GitHub settings to read from the
  project-scoped settings keys.
- `selectIssueSource` should write to the project-scoped `issueSourceId`.

## Open Questions

- Should `project add` enforce unique `id` only, or also unique `name`?
- What default `targetBranch` should be used when unset? (current branch or none)

## Acceptance Criteria

- `project` commands exist with add/rm/ls/enable/disable.
- A default project is available and enabled on first run.
- `plan` and `issue` prompt for a project.
- The root loop processes enabled projects concurrently using per-project
  concurrency, target branch, review mode, and git flow mode.
- Global CLI flags for target branch, review, git flow mode, and concurrency are removed.
