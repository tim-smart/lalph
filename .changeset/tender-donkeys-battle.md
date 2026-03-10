---
"lalph": patch
---

Fix task cancellation cleanup so early exits preserve the intended todo reversion behavior without overwriting other external task state changes.
