---
"lalph": patch
---

Fix Claude chooser invocation by inserting `--` before the prompt argument when using `--disallowed-tools`. This prevents variadic tool parsing from swallowing the positional prompt and restores chooser task selection.
