# CLI Agent Presets

## Summary

Add `lalph agents ...` commands to manage CLI agent presets and use them to
select the right agent per task. Presets define the CLI agent, extra arguments,
and optional issue-source matching (for example, labels). When `lalph` starts
without presets it prompts to add one; when a task has no matching preset it
prompts to add one.

## Goals

- Let users create, list, edit, and remove CLI agent presets via `lalph agents`.
- Support label-based preset matching for GitHub and Linear issues.
- Apply presets automatically during task execution and review.
- Prompt to create a preset when none exist or when a task has no match.

## Non-Goals

- No automatic label creation or label syncing.
- No UI outside the CLI (no web or TUI).
- No changes to issue-source selection (`lalph source`).
- No multi-agent orchestration within a single task.
- No preset reordering command (reorder by remove/add).
- No changes to `PrdIssue` schema.

## Assumptions

- Presets are stored in settings and are global (not per project).
- Label matching uses the issue source's label identifiers:
  - GitHub: label names.
  - Linear: label names (resolved from label IDs at fetch time).
- A preset with no match criteria is considered the default preset.
- Label matching is case-insensitive and trims whitespace.

## Users

- CLI users who want different models/agents per labeled task.
- Teams that encode execution preferences via issue labels.

## User Stories

- As a user, I can add a preset that uses `claude` with model args for `opus`.
- As a user, I can list presets to see which labels map to which agents.
- As a user, I am prompted to add a preset when none exist.
- As a user, if a task has no matching preset, I can add one and continue.

## Functional Requirements

- The CLI exposes `lalph agents` with `ls`, `add`, `edit`, and `rm` subcommands.
- Presets include: `id`, `cliAgent`, `extraArgs`, and optional match criteria.
- Presets store optional issue-source metadata for matching.
- Match criteria are stored per issue source.
- Preset matching uses list order; the first match wins.
- A preset with no match criteria is treated as the default preset.
- On `lalph` startup, if no presets exist, prompt to add one.
- When a task is chosen and no preset matches it, prompt to add one.
- The chosen preset is used for worker/reviewer/timeout agents.
- Planning flows (`lalph plan`, `lalph plan tasks`) use the default preset.
- Extra args apply to agent command invocations (task worker, chooser, reviewer,
  timeout, planner, tasker) unless the agent explicitly ignores them.
- Label matching is case-insensitive; any issue label match qualifies.
- IssueSource resolves the preset for a given issue.

## Data Model

Extend `CliAgentPreset` with optional source matching and metadata:

```ts
type CliAgentPreset = {
  id: string
  cliAgent: AnyCliAgent
  extraArgs: string[]
  sourceMetadata?: {
    github?: unknown
    linear?: unknown
  }
}
```

`sourceMetadata` is stored per issue source.
Label-based matching uses `sourceMetadata.github.label` (label name) or
`sourceMetadata.linear.labelId` (label id), depending on the issue source.

Schema shape for `sourceMetadata`:

```ts
Schema.Struct({
  github: Schema.optional(
    Schema.Struct({
      label: Schema.optional(Schema.String),
    }),
  ),
  linear: Schema.optional(
    Schema.Struct({
      labelId: Schema.optional(Schema.String),
    }),
  ),
})
```

## Issue Preset Resolution

Add an IssueSource method to resolve the preset for a given issue:

```ts
issuePreset(issueId: string): Effect<CliAgentPreset, IssueSourceError>
```

- IssueSource is responsible for matching presets based on source metadata.
- GitHub matches on label names (case-insensitive, trimmed).
- Linear matches on label IDs (exact match).
- If no preset matches and no default preset exists, return a not-found error.
- IssueSource may cache issue metadata to avoid repeated API calls.

## Preset Matching

- Evaluate presets in stored order.
- A preset matches when:
  - `sourceMetadata` is undefined (default preset), or
  - the current issue source has metadata configured and
    its label criterion is undefined or the issue labels include it.
- If multiple presets match, the first in list is chosen.
- Label matching is case-insensitive and trims whitespace on both sides.
- Label criteria are only supported when metadata for the current source is set.
- Matching uses `IssueSource.issuePreset` for the chosen task.
- If no preset matches and no default exists, prompt to add a preset with
  the issue source preselected and the label prompt focused on the issue's
  labels (when available).
- After adding a preset, re-evaluate matching; if still no match, fail with an
  actionable message to edit presets.

## CLI Commands

### `lalph agents ls`

- List presets in order with id, agent name, extra args, and match criteria.
- Show `Default` when no match criteria are set.
- Ordering is creation order; to reprioritize, remove and re-add presets.

### `lalph agents add`

Prompt flow:

- Preset name (unique, non-empty).
- CLI agent selection from `allCliAgents`.
- Extra args as a single string, parsed into argv (supports quotes).
- Match scope:
  - Any source (default preset)
  - GitHub issues
  - Linear issues
- If GitHub/Linear selected: optional label filter
  - GitHub: free text (empty for none).
  - Linear: autocomplete from labels (empty for none, stores label id).
  - Label stored as `sourceMetadata.github.label` or
    `sourceMetadata.linear.labelId`.
  - Selecting a source with no label stores empty metadata for that source.

### `lalph agents edit`

- Select a preset to edit.
- Re-run the same prompts as `add`, prefilled with current values.

### `lalph agents rm`

- Select a preset to remove.
- Confirm removal before deleting.

### Legacy `lalph agent`

- If no presets exist, route to `lalph agents add`.
- If presets exist, edit the default preset (the first preset with no match).

## Storage & Migration

- Add `cliAgentPresets` setting (array of `CliAgentPreset`).
- No migration from `selectedCliAgentId`.

## Error Handling & Edge Cases

- Duplicate preset ids are rejected on add/edit.
- If label metadata is unavailable, allow adding a preset with free-text label.
- If no default preset exists, startup prompt requires creating one.
- If a task has no match and user aborts the prompt, stop the run with a clear
  message to add a preset via `lalph agents add`.
- In non-interactive environments, missing preset prompts fail fast with an
  actionable error (no blocking prompt).
- IssueSource caches issue metadata where possible to reduce API calls.

## Acceptance Criteria

- `lalph agents` can add, list, edit, and remove presets.
- Starting `lalph` with zero presets prompts to add one.
- A labeled task uses the preset that matches its issue source and label.
- A task with no matching preset prompts to add one.
- Planning flows use the default preset.

## Implementation Plan

1. Update domain/source interfaces, settings, and matching utilities together:
   - Extend `CliAgentPreset` with `sourceMetadata`.
   - Add `IssueSource.issuePreset` and implement matching for GitHub and Linear.
   - Create `cliAgentPresets` setting.
   - Implement label normalization and default preset lookup for IssueSource use.
   - Handle non-interactive missing-preset errors.
2. Add `lalph agents` command set:
   - `ls`, `add`, `edit`, `rm` prompts storing `sourceMetadata.label`.
   - Wire into CLI root and legacy `lalph agent` behavior.
3. Integrate presets into runtime flows:
   - Startup prompt when no presets exist (TTY only).
   - After choosing a task, call `issuePreset` and select preset.
   - Use matched preset for worker/reviewer/timeout; default for chooser/plan.
4. Add a changeset describing the new feature.
