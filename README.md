# lalph 🚀

A LLM agent orchestrator driven by your chosen source of issues.

## Features ✨

- 🔌 Integrate with various issue sources (GitHub Issues, Linear, etc.)
- 🧭 Plan mode to generate issues from high-level goals
- 🌿 Uses git worktrees to allow for multiple concurrent iterations
- 📝 Creates pull requests for each task, with optional auto-merge for vibe coding
- 🔗 Support issue dependencies to ensure correct task order

## Installation 🛠️

```bash
npm install -g lalph
```

or run with npx:

```bash
npx -y lalph@latest
```

## CLI usage 🧰

- ▶️ Run the main loop: `lalph`
- ⚡ Run multiple iterations with concurrency: `lalph --iterations 4 --concurrency 2`
- 🧭 Start plan mode: `lalph plan`
- ⚠️ Start plan mode without permission prompts: `lalph plan --dangerous`
- 🗂️ Choose your issue source: `lalph source`

It is recommended to add `.lalph/` to your `.gitignore` to avoid committing your
credentials.

## Development 🧑‍💻

- Install dependencies: `pnpm install`
- Build the CLI: `pnpm build`
