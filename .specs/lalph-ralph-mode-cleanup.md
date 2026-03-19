# Lalph Ralph Mode Cleanup

## Summary

Clean up Ralph mode execution logic by extracting named functions that hide
mode-specific branching and reduce inline conditionals/ternaries. Focus on
`src/commands/root.ts` and Ralph branching in agent files so the control flow
is easier to read without changing intended behavior. Agent branching should use
a shared `CurrentTask` discriminated interface with a `_tag` field.

## Research Findings

- `src/commands/root.ts` has dense Ralph branching in `runProject`, including
  nested ternaries for GitFlow layer selection, run strategy selection, and
  per-iteration completion behavior.
- `src/Agents/worker.ts`, `src/Agents/reviewer.ts`, and `src/Agents/timeout.ts`
  each duplicate Ralph/default conditionals for prompt/system/mode/prd paths.
- `src/Agents/timeout.ts` repeats `options.task._tag === "ralph"` across
  multiple fields, increasing cognitive load.
- `src/Agents/timeout.ts` intentionally uses different timeout prompts between
  execution paths in standard mode (`promptTimeoutClanka` for Clanka vs
  `promptTimeout` for CLI command), so descriptor refactoring must preserve
  this split.
- `src/Agents/worker.ts` and `src/Agents/reviewer.ts` use `ralph: boolean`
  while `src/Agents/timeout.ts` uses a tagged task union, so mode branching
  shape is inconsistent across agents.
- `src/Agents/reviewer.ts` intentionally uses different
  `promptReviewCustom(...removePrdNotes)` settings between execution paths
  (`true` for Clanka, `false` for CLI command), so this behavior must be
  preserved while refactoring mode branching.
- `src/commands/root.ts` uses `options.project.ralphSpec!` in Ralph execution,
  which is brittle if a Ralph project is missing `ralphSpec`.
- Missing-`ralphSpec` validation must occur before the iteration loop in
  `runProject`; otherwise the generic per-iteration `catchCause` path retries
  indefinitely and masks the configuration issue.
- There was no shared `CurrentTask` domain tagged enum yet, so worker/refactor
  work needed a new `src/domain/CurrentTask.ts` source of truth before agent
  signatures could switch away from `ralph: boolean`.

## Requirements Gathered From User Interview

- Scope: cleanup should cover root flow and agents.
- Behavior policy: readability refactor first, but safe low-risk bug fixes are
  allowed when discovered.
- Extraction style: prefer named local helper functions over new shared modules.
- Done criteria focus: reduce inline ternaries/conditionals by moving complexity
  behind intention-revealing function names.
- Agent API requirement: use a `CurrentTask` interface with `_tag` for agent
  mode branching instead of mixed booleans/ad-hoc unions.

## Goals

- Make Ralph mode control flow self-describing in root and agent paths.
- Replace repeated inline mode checks with small named helpers.
- Preserve current execution semantics unless a safe bug fix is explicitly
  captured in this spec.
- Keep refactor reviewable and incremental.

## Non-Goals

- No redesign of git-flow architecture or issue-source architecture.
- No new mode types beyond existing `pr`, `commit`, and `ralph`.
- No broad shared utility package for mode handling.
- No behavioral rewrites of planner/task selection flows outside targeted files.

## Scope

Primary files:

- `src/commands/root.ts`
- `src/Agents/worker.ts`
- `src/Agents/reviewer.ts`
- `src/Agents/timeout.ts`

`src/Clanka.ts` is out of scope unless this refactor introduces a compile,
type, or runtime issue that cannot be resolved in the primary files.

## Functional Requirements

### 1) Root Ralph Branching Readability

- Extract named helper functions in `src/commands/root.ts` for:
  - git-flow layer resolution (`pr` / `commit` / `ralph`)
  - run-effect selection (`run` vs `runRalph`)
  - iteration wait strategy (await fiber directly in Ralph mode vs await
    `startedDeferred` in non-Ralph mode)
  - mode-specific handling in `ChosenTaskNotFound` / `NoMoreWork` paths
- Remove nested ternaries in the `runProject` iteration loop by extracting
  named local helpers; keep inline conditionals only when a helper would reduce
  clarity.
- Keep helper functions colocated in the same file (local extraction preferred).

### 2) Agent Ralph Branching Readability

- Introduce a shared `CurrentTask` discriminated type with `_tag` used by all
  branching agents.
- Define `CurrentTask` with `Data.TaggedEnum` so agents can use built-in
  pattern-matching helpers for readable branching.
- Define `_tag` variants for standard task flow and Ralph flow, with only the
  fields required by agent prompt/system/mode/path decisions.
- Place this shared type in a domain-level location (for example,
  `src/domain/CurrentTask.ts`) and import it across agents.

- Replace inline Ralph ternaries with helper functions in:
  - `src/Agents/worker.ts` for `mode` and `prdFilePath` decisions
  - `src/Agents/reviewer.ts` for system prompt mode handling
  - `src/Agents/timeout.ts` for timeout prompt/system/mode/prd path decisions
- In `src/Agents/timeout.ts`, compute a single mode descriptor from task tag
  and reuse it instead of repeating `_tag === "ralph"` checks.
- Replace `ralph: boolean` in agent option signatures with
  `currentTask: CurrentTask` where branching is required.

### 3) Safe Bug Fix Guardrail

- Add a defensive guard for missing Ralph specification path before execution
  (currently non-null assertion `ralphSpec!` is used).
- If missing, fail early with a clear actionable message and do not attempt to
  run Ralph worker logic.
- Only bug fixes directly required by this refactor are allowed (for example,
  null/undefined guards or equivalent control-flow safety).
- Do not change planner or task-selection semantics as part of this cleanup.

### 4) Non-Ralph Regression Guard

- `pr` and `commit` behavior must remain unchanged.
- Refactoring in shared code paths must preserve existing control-flow
  semantics for non-Ralph projects.

### 5) Validation Safety

- Every implementation task must leave the repo in a state that passes
  `pnpm check`.
- Keep each task independently shippable: no temporary broken intermediate
  abstractions.

## Acceptance Criteria

- Root and agent Ralph paths use named helpers instead of dense inline
  conditionals/ternaries.
- No nested ternary chains remain in Ralph selection/control-flow logic in
  `src/commands/root.ts` and `src/Agents/timeout.ts`.
- Ralph execution behavior is preserved for normal configured projects.
- `pr` and `commit` behavior remains unchanged.
- Each primary file (`src/commands/root.ts`, `src/Agents/worker.ts`,
  `src/Agents/reviewer.ts`, `src/Agents/timeout.ts`) contains extracted local
  helper(s) replacing prior inline Ralph branching in touched sections.
- Branching agents use a shared `CurrentTask` `_tag` contract for Ralph vs
  standard mode decisions.
- Branching agents use `Data.TaggedEnum` matching helpers (for example,
  `CurrentTask.$match(...)`) for mode-dependent logic, instead of ad-hoc
  conditional chains.
- `src/Agents/worker.ts` and `src/Agents/reviewer.ts` no longer accept
  `ralph: boolean` options for mode branching.
- `src/Agents/timeout.ts` uses the shared `CurrentTask` type instead of an
  agent-local ad-hoc tagged union.
- Misconfigured Ralph projects without `ralphSpec` fail before worker startup
  with an actionable message that names `ralphSpec` and indicates how to
  configure it.
- No non-null assertion (`!`) is used for `project.ralphSpec` in Ralph
  execution path.
- Exactly one changeset is added under `.changeset/` describing the readability
  refactor and the missing-`ralphSpec` guard.
- `pnpm check` passes after each shipped task.

## Risks and Mitigations

- Risk: subtle control-flow changes in iteration loop.
  - Mitigation: extract pure decision helpers first, then wire in place with
    one-for-one behavior mapping.
- Risk: accidental divergence between CLI-agent and Clanka prompt behavior.
  - Mitigation: centralize per-file mode decisions into single helper outputs
    reused by both branches.
- Risk: introducing dead helpers during staged refactor.
  - Mitigation: keep helper introduction and usage in the same task.

## Implementation Plan

1. [x] Refactor root Ralph branching into local decision helpers.
   - File: `src/commands/root.ts`
   - Extract helper functions for git-flow layer choice, run strategy choice,
     mode-specific catch handling, and iteration waiting behavior.
   - Replace inline ternaries/conditionals in `runProject` with helper calls.
   - Add early guard for missing `project.ralphSpec` in Ralph path.
   - Validation gate: run `pnpm check`.

2. [x] Refactor worker mode conditionals into local helpers.
   - File: `src/Agents/worker.ts`
   - Switch branching input to `currentTask: CurrentTask` and branch on `_tag`.
   - Use `CurrentTask` tagged-enum matching helpers for mode/prd path
     derivation.
   - Introduce local helper functions that resolve mode/prd path decisions once
     and reuse them.
   - Keep existing prompt construction and command execution behavior.
   - Validation gate: run `pnpm check`.

3. [x] Refactor reviewer mode conditionals into local helpers.
   - File: `src/Agents/reviewer.ts`
   - Switch branching input to `currentTask: CurrentTask` and branch on `_tag`.
   - Use `CurrentTask` tagged-enum matching helpers for system/mode decisions.
   - Introduce local helper functions for Ralph/default system handling and
     avoid repeated inline mode checks.
   - Keep existing review prompt-selection behavior unchanged.
   - Validation gate: run `pnpm check`.

4. [x] Refactor timeout task-tag branching into a single mode descriptor.
   - File: `src/Agents/timeout.ts`
   - Migrate timeout options to shared `CurrentTask` type.
   - Use `CurrentTask` tagged-enum matching helpers to build the timeout mode
     descriptor.
   - Build one local descriptor/helper for Ralph vs standard timeout context,
     then reuse it for prompt/system/mode/prd path decisions.
   - Eliminate repeated `_tag === "ralph"` checks in object literals.
   - Validation gate: run `pnpm check`.

5. [x] Add release metadata only.
   - File: `.changeset/*` (single changeset)
   - Add one changeset describing the Ralph-mode readability cleanup and
     defensive guard behavior.
   - Do not include additional code cleanup in this task.
   - Validation gate: run `pnpm check`.

## Implementation Notes

- Prefer helper names that communicate intent over implementation detail, such
  as `resolveRunEffect`, `resolveTimeoutPrompt`, `resolveAgentMode`, etc.
- Prefer discriminated-union narrowing (`switch`/match on `_tag`) over boolean
  flags for mode branching in agent inputs.
- Prefer `Data.TaggedEnum` match helpers for branching so all agents use a
  consistent, declarative pattern.
- Keep helper scope file-local unless true reuse emerges during implementation.
- Do not collapse `run` and `runRalph` into one large generalized function in
  this effort; prioritize readability and low-risk extraction.
