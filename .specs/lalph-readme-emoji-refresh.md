# Lalph README Emoji Refresh

## Summary

Add a high-density, playful emoji pass to the root `README.md` so it feels more
expressive and visually scannable, while preserving markdown structure,
command accuracy, and accessibility.

## Request Context

Original request: "add emojis to the readme".

Interview outcomes captured for this specification:

- Scope: update headings and bullet content.
- Density: high.
- Style: playful/fun.
- Accessibility/scannability: keep standard `-` bullets (do not switch to
  emoji-only list markers).

## Goals

- Add emojis to README headings and bullet text with a consistent style.
- Preserve all command examples, technical meaning, and markdown rendering.
- Increase visual friendliness without making sections hard to scan.

## Non-Goals

- No changes to CLI behavior, command names, flags, or examples.
- No changes to project code, tests, or runtime behavior.
- No rewrite of the README structure beyond emoji-oriented copy edits.

## Change Scope

- Allowed file modifications for implementation:
  - `README.md`
- Process/supporting files for planning metadata (already created by this plan):
  - `.specs/README.md`
  - `.lalph/plan.json`

## Functional Requirements

### 1) Heading Emoji Coverage

- Add one emoji prefix to each H2 section heading in `README.md`:
  - Features
  - Installation
  - CLI usage
  - Agent presets
  - Projects
  - Plan mode
  - Creating issues
  - Development
- Keep heading wording unchanged other than emoji prefix.
- After edits, verify markdown anchors/links still resolve as expected; if any
  anchor regression appears, switch to emoji suffix placement for that heading.

### 2) Bullet Emoji Coverage

- Keep markdown list syntax as standard `-` bullets.
- Add emojis inside bullet content at high density, targeting bullets in:
  - Features
  - CLI usage
  - Development
  - Other list-based guidance sections
- At least 80% of eligible bullet lines in the target sections include exactly
  one emoji.
- Up to 10% of eligible bullet lines may include two emojis when semantically
  useful and still readable.
- Avoid inserting emojis in a way that obscures key terms.

### 3) Prose and Code Block Safety

- Do not alter fenced code blocks except where a textual typo correction is
  needed outside this request (none expected).
- Do not add emojis inside backticked inline code spans (commands, flags,
  paths) so copy/paste behavior remains unchanged.
- Preserve the ASCII title art block at the top of the README.

### 4) Emoji Style Rules

- Use a playful/fun tone while keeping semantic relevance (for example,
  installation-related lines use package/tooling-themed emojis).
- Default to one emoji per updated line.
- Allow occasional two-emoji lines only within the bullet-density limit above.
- Avoid culturally specific, ambiguous, or decorative-only emoji usage that
  adds noise.

### 5) Documentation Integrity

- Ensure all existing commands and options remain exactly accurate.
- Keep line wrapping and markdown formatting consistent with repository style.

## Acceptance Criteria

- The 8 README H2 headings listed in this spec each have exactly one emoji
  prefix.
- At least 80% of eligible bullet lines in target sections include emojis while
  retaining standard `-` markers.
- No newly inserted emojis appear in fenced code blocks or backticked inline
  code spans.
- README remains accurate to current CLI behavior and renders correctly.
- `.specs/README.md` includes a link to this specification with a brief summary.

## Risks and Mitigations

- Risk: Emoji overuse harms readability.
  - Mitigation: apply one-emoji default and review section-by-section for
    scan quality.
- Risk: accidental changes inside command examples.
  - Mitigation: perform explicit pass to confirm code fences and inline code
    remain unchanged.
- Risk: inconsistent tone across sections.
  - Mitigation: define a small emoji style map before editing.

## Implementation Discoveries and Issues

- Discovery: This task iteration is scoped to H2 heading emoji prefixes only;
  bullet-level emoji additions remain for a follow-up task.
- Discovery: Prefix emoji placement keeps markdown heading syntax valid and
  preserves expected heading rendering.
- Validation: `pnpm check` passed after applying heading updates.
- Issues found: none.

## Implementation Plan

1. [x] Add emoji prefixes to all in-scope README headings.
   - Update the 8 listed H2 headings with one playful, semantically relevant
     prefix emoji each.
   - Keep heading text intact beyond emoji insertion.
   - Definition of done: markdown remains well-formed and `pnpm check` passes.

2. [ ] Add high-density emojis to in-scope README bullet lines.
   - Update bullet text while preserving `-` markers and command accuracy.
   - Meet density threshold (>=80% eligible bullet coverage) without editing
     fenced or inline code.
   - Definition of done: readability remains strong and `pnpm check` passes.
   - Status: pending (not part of this heading-only task iteration).

3. [ ] Run final integrity and acceptance sweep.
   - Verify acceptance criteria (heading coverage, bullet coverage, code safety,
     command accuracy, rendering).
   - Verify `.specs/README.md` still references this spec.
   - Definition of done: all acceptance criteria are satisfied and
     `pnpm check` passes.
   - Status: pending until bullet coverage work is completed.

## Validation Plan

- Primary: `pnpm check` passes.
- Manual checks:
  - Scan `README.md` headings for emoji coverage.
  - Spot-check bullet-heavy sections for high-density emoji usage.
  - Verify fenced code blocks contain no newly added emojis.
