---
"lalph": patch
---

Refactor Ralph branching in `src/commands/root.ts` by extracting named helpers for git-flow layer selection, run-effect selection, iteration waiting, and mode-specific no-work handling. Add an early actionable failure when a Ralph project is missing `ralphSpec` so Ralph worker startup is blocked for misconfigured projects.
