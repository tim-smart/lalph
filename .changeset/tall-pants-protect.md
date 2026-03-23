---
"lalph": patch
---

Update `IssueSource.make` to mutate cached issue state via `SubscriptionRef.update` after create / update / cancel operations instead of immediately re-fetching issues from the backing API.
