---
"lalph": patch
---

Prevent Claude CLI runs from swallowing Ctrl-C by avoiding inherited stdin and terminating Claude with SIGINT, escalating to SIGKILL if needed.

Inject GitHub PR feedback in commit mode when the configured target branch has an open PR.
