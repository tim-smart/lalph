---
"lalph": patch
---

Prefer the current working directory for `.lalph` lookups, then fall back to the project root when running from subdirectories. This keeps settings, cache, and worktree behavior aligned with the main project `.lalph` directory.
