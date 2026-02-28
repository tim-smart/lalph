---
"lalph": patch
---

Add ETag-based conditional request caching to the GitHub API client so repeated GET calls can reuse cached responses when GitHub returns `304 Not Modified`, reducing API rate limit usage.
