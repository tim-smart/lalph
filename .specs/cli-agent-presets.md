# CLI Agent Presets

## Summary

Add `lalph agents ...` commands to manage CLI agent presets. Presets define the
CLI agent, command prefix, extra args, and per-issue-source metadata (labels)
used to map issues to presets. A `default` preset is created via a welcome
wizard when missing; it is used for task selection and planning and as the
fallback when no issue-specific preset matches.

## Goals

- Let users create, list, edit, and remove CLI agent presets via `lalph agents`
  (and the `lalph a` alias).
- Support label-based preset matching for GitHub and Linear issues.
- Apply presets automatically during task execution and review, falling back to
  the default preset.

## Non-Goals

- No automatic label creation or label syncing.
- No UI outside the CLI (no web or TUI).
- No changes to issue-source selection (`lalph source`).
- No multi-agent orchestration within a single task.
- No preset reordering command (reorder by remove/add).
- No changes to `PrdIssue` schema.

## Assumptions

- Presets are stored in settings and are global (not per project).
- The default preset has id `default`.
- Label matching uses the issue source's label identifiers:
  - GitHub: label names (exact match).
  - Linear: label ids (exact match).
- Matching uses stored preset order; the first match wins.

## Users

- CLI users who want different models/agents per labeled task.
- Teams that encode execution preferences via issue labels.

## User Stories

- As a user, I can add a preset that uses `claude` with model args for `opus`.
- As a user, I can list presets to see which labels map to which agents.
- As a user, I am prompted to add a default preset when one does not exist.
- As a user, tasks without a matching preset fall back to the default preset.

## Functional Requirements

- The CLI exposes `lalph agents` with `ls`, `add`, `edit`, and `rm` subcommands
  plus the `lalph a` alias.
- Presets include: `id`, `cliAgent`, `commandPrefix`, `extraArgs`, and
  `sourceMetadata`.
- The default preset has id `default` and is created via the welcome wizard
  when missing.
- Non-default presets are updated with metadata from the current issue source
  during add/edit.
- IssueSource exposes:
  - `issueCliAgentPreset(issue: PrdIssue)` -> `Option<CliAgentPreset>`
  - `updateCliAgentPreset(preset: CliAgentPreset)` -> `CliAgentPreset`
  - `cliAgentPresetInfo(preset: CliAgentPreset)` for `ls` output
- Task selection uses the default preset; issue-specific presets are used for
  worker/reviewer/timeout when available, otherwise the default is used.
- Planning flows (`lalph plan`, `lalph plan tasks`) use the default preset.
- Command prefix is applied to all agent commands.
- Extra args are passed to chooser/reviewer/timeout/planner/tasker; worker
  currently ignores extra args.
- GitHub label matching uses exact label names; Linear uses exact label ids;
  first matching preset wins.

## Data Model

Extend `CliAgentPreset` with command prefix and source metadata:

```ts
type CliAgentPreset = {
  id: string
  cliAgent: AnyCliAgent
  commandPrefix: string[]
  extraArgs: string[]
  sourceMetadata: Record<string, unknown>
}
```

`sourceMetadata` is stored per issue source and encoded by each IssueSource.
Label-based matching uses `sourceMetadata.github.label` (label name) or
`sourceMetadata.linear.labelId` (label id).

Schema shape for `sourceMetadata`:

```ts
Schema.Struct({
  github: Schema.Struct({
    label: Schema.NonEmptyString,
  }),
})

Schema.Struct({
  linear: Schema.Struct({
    labelId: Schema.String,
  }),
})
```

## Issue Preset Resolution

IssueSource resolves a preset for a given issue:

```ts
issueCliAgentPreset(
  issue: PrdIssue,
): Effect<Option<CliAgentPreset>, IssueSourceError>
```

- IssueSource is responsible for matching presets based on source metadata.
- GitHub matches on label names (exact match).
- Linear matches on label ids (exact match).
- If no preset matches, `None` is returned and the default preset is used.
- IssueSource may cache issue metadata to avoid repeated API calls.

## Preset Matching

- Presets are evaluated in stored order when building the issue preset map.
- GitHub: when issues are fetched, the first preset whose metadata label matches
  an issue label is recorded for that issue id.
- Linear: when issues are fetched, the first preset whose metadata label id is
  included in the issue label ids is recorded for that issue id.
- `issueCliAgentPreset` returns the recorded preset for the issue, or `None`.
- When no match exists, the default preset is used by the runtime flow.

## CLI Commands

### `lalph agents ls`

- Print the current issue source name.
- List presets in order with id, source metadata (if available), agent name,
  extra args, and command prefix.
- Ordering is creation order; to reprioritize, remove and re-add presets.

### `lalph agents add`

Prompt flow:

- Preset name (unique, non-empty).
- CLI agent selection from `allCliAgents`.
- Extra args as a single string, parsed into argv (supports quotes).
- Command prefix as a single string, parsed into argv (supports quotes).
- If the preset id is not `default`, prompt the current issue source to attach
  metadata:
  - GitHub: text input for a label (non-empty).
  - Linear: autocomplete selection of a label (required).

### `lalph agents edit`

- Select a preset to edit.
- Re-run the same prompts as `add`, prefilled with current values.
- For non-default presets, the current issue source prompts for metadata again.

### `lalph agents rm`

- Select a preset to remove.
- Remove without additional confirmation.

## Storage & Migration

- Add `cliAgentPresets` setting (array of `CliAgentPreset`).
- No migration from `selectedCliAgentId`.

## Error Handling & Edge Cases

- Duplicate preset ids are rejected on add/edit.
- GitHub presets require a non-empty label; Linear presets require a label
  selection.
- If no default preset exists, the welcome wizard runs when default is
  requested (startup, plan, task selection).
- IssueSource may cache issue metadata to reduce API calls.

## Acceptance Criteria

- `lalph agents` can add, list, edit, and remove presets (`lalph a` works).
- Running `lalph` or `lalph plan` with no default preset prompts to create one.
- A labeled task uses the preset that matches its issue source and label.
- A task with no matching preset falls back to the default preset.
- Planning flows use the default preset.

## Implementation Plan

1. Update domain/source interfaces, settings, and matching utilities together:
   - Extend `CliAgentPreset` with `commandPrefix` and `sourceMetadata`.
   - Add `IssueSource.issueCliAgentPreset` plus source-specific metadata
     helpers (`updateCliAgentPreset`, `cliAgentPresetInfo`).
   - Create `cliAgentPresets` setting and default preset id `default`.
2. Add `lalph agents` command set (and `lalph a` alias):
   - `ls`, `add`, `edit`, `rm` prompts; store source metadata via
     `IssueSource.updateCliAgentPreset`.
3. Integrate presets into runtime flows:
   - Welcome wizard when default preset is missing.
   - Use default preset for chooser/planning/tasker; use issue-specific preset
     for worker/reviewer/timeout when available.
