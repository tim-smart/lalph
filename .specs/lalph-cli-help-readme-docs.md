# Lalph CLI Help and README Refresh

## Summary

Improve the CLI help output and the root README so that each feature is
explained concisely with a clear purpose and a short usage guide. Add README
sections for agent presets, projects, plan mode, and creating issues. Align all
text with existing CLI behavior and commands, and keep the tone and formatting
consistent with current docs.

## Goals

- Make CLI `--help` output describe what each command/flag does and how to use
  it, without becoming verbose.
- Expand the README to include short, practical sections for:
  - Agent presets
  - Projects
  - Plan mode
  - Creating issues
- Provide 1–2 concise usage examples per README section.
- Keep documentation accurate to current behavior in `src/commands` and related
  flows.
- Keep updates minimal and targeted so existing doc structure remains familiar.

## Non-Goals

- No changes to CLI behavior, command signatures, or output formatting beyond
  descriptions.
- No new features or new commands.
- No changes to issue-source integrations or agent execution logic.
- No changes to configuration formats beyond documenting existing ones.
- No broad README rewrites (only add/adjust sections required by the request).

## Background

- CLI help text comes from `Command.withDescription`, `Flag.withDescription`,
  and `Argument.withDescription` in `src/commands`.
- The README currently includes a short features list and minimal CLI usage.
- Existing features include plan mode, projects, agent presets, issue creation,
  worktrees, and issue-source selection.

## Target Audience

- CLI users setting up and running lalph for the first time.
- Existing users who want quick reminders of core commands and workflows.

## Functional Requirements

### CLI Help Documentation

Update command and flag descriptions so each one answers:
"What is this for?" and "How do I use it?" in 1–2 sentences.

General constraints:

- Keep existing ordering and formatting of help output; update descriptions only.
- Use plain, direct phrasing; avoid marketing language.
- Make descriptions consistent with actual command behavior in `src/commands/**`.

Commands to cover:

- Root command `lalph`:
  - Purpose: run the task loop across enabled projects, pulling tasks from the
    selected issue source and executing with the configured agent preset(s).
  - Include usage hint referencing iterations and concurrency (project-level).
- `plan`:
  - Purpose: open an editor to draft a plan, turn it into a specification, then
    generate tasks from that spec.
  - Mention `--dangerous` and `--new` usage in the description or flag docs.
- `plan tasks`:
  - Purpose: convert a spec file into tasks without re-running the plan.
  - Argument description must clearly indicate a file path is required.
- `issue` / `i`:
  - Purpose: create a new issue by filling out a file with YAML front matter.
  - Mention that saving the file creates the issue in the current issue source.
- `edit` / `e`:
  - Purpose: open the local `.lalph/prd.yml` for the selected project.
- `source`:
  - Purpose: choose the issue source (e.g., GitHub Issues or Linear).
- `agents` / `a`:
  - Purpose: manage CLI agent presets used to run tasks.
  - Each subcommand (`ls`, `add`, `edit`, `rm`) should include a short
    description of what it does.
- `projects` / `p`:
  - Purpose: manage projects and their execution settings.
  - Each subcommand (`ls`, `add`, `edit`, `toggle`, `rm`) should include a short
    description of what it does.
- `sh`:
  - Purpose: open an interactive shell inside the worktree for the active
    project and link `.lalph` config for access.

Flags to tighten with purpose + usage hints:

- `--iterations` / `-i`: note that it limits the number of task iterations.
- `--max-minutes`: note that it caps a single iteration runtime.
- `--stall-minutes`: note that it cancels an iteration after inactivity.
- `--specs` / `-s`: note that it controls where plan specs are stored.
- `--verbose` / `-v`: note that it increases log output for debugging.

If additional flags or subcommands exist in `src/commands/**`, include them with
the same purpose + usage structure.

### README Updates

Add or expand the following sections with concise purpose + usage and include
1–2 example commands each:

#### Agent presets

- Explain what a preset is and that a default preset is required and created
  via the welcome flow when missing.
- Explain label-based matching and that non-matching issues use the default.
- Show basic usage with `lalph agents ls` and `lalph agents add`.

#### Projects

- Explain that projects group settings like concurrency, target branch, git
  flow, and review agent.
- Mention enabling/disabling projects and selecting which project to run.
- Show `lalph projects add`, `lalph projects ls`, `lalph projects toggle`.

#### Plan mode

- Explain that plan mode creates a spec from a high-level plan and then creates
  tasks from that spec.
- Mention `--dangerous` behavior (skips permission prompts).
- Show `lalph plan` and `lalph plan tasks path/to/spec.md` examples.

#### Creating issues

- Explain how `lalph issue` opens a template and saves the issue to the active
  issue source.
- Document only the front matter fields that exist in the current template.
- Show `lalph issue` / `lalph i` usage.

Additional README adjustments:

- Update the main Features list and/or CLI usage section to include the new
  capabilities (agent presets, projects, plan mode, issue creation) with short
  descriptions.
- Keep the README concise and consistent with existing style.
- If a README table of contents exists, add the new sections there as well.
- Keep examples short (single command lines where possible).

## Acceptance Criteria

- CLI `--help` output now concisely explains each command/subcommand purpose
  and how to use it.
- Root README includes the four required sections with 1–2 usage examples each.
- All doc text matches the current CLI behavior and command names.
- `.specs/README.md` links to this spec with a short summary.
- README uses only fields that exist in the issue template.

## Implementation Plan

1. Audit CLI commands/flags and draft concise description text.
   - Update `Command.withDescription`, `Flag.withDescription`, and
     `Argument.withDescription` in `src/commands/**`.
   - Ensure subcommands and additional flags not listed above are covered.
2. Update `README.md` with the new sections and refresh existing features/usage
   to align with the improved CLI help text and verified issue template fields.
   - Update any README table of contents if present.
3. Add a changeset describing the documentation update if required by repo
   policy.
4. Confirm `.specs/README.md` still references this spec.

## Notes

- Prefer short sentences and avoid redundant phrasing between CLI help and
  README text.
- If help output needs verification, use `node src/cli.ts --help` or
  `node src/cli.ts <subcommand> --help`.
