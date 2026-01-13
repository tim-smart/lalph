import { Effect, FileSystem, Layer, ServiceMap } from "effect"
import { Linear } from "./Linear.ts"
import { PrdIssue } from "./Prd.ts"

export class PromptGen extends ServiceMap.Service<PromptGen>()(
  "lalph/PromptGen",
  {
    make: Effect.gen(function* () {
      const linear = yield* Linear
      const fs = yield* FileSystem.FileSystem

      yield* Effect.scoped(
        fs.open("PROGRESS.md", {
          flag: "a+",
        }),
      )

      const prompt = `# Instructions

1. Decide which single task to work on next from the prd.json file. This should
   be the task YOU decide as the most important to work on next, not just the
   first task in the list.
2. Before starting the chosen task, mark it as "in progress" by updating its
   \`stateId\` in the prd.json file.
   This prevents other people or agents from working on the same task simultaneously.
3. Check if there is an existing Github PR for the task, otherwise create a new
   branch for the task.
   - If there is an existing PR, checkout the branch for that PR.
   - If there is an existing PR, check if there are any new comments or requested
     changes, and address them as part of the task.
4. Run any checks / feedback loops, such as type checks, unit tests, or linting.
5. APPEND your progress to the PROGRESS.md file.
6. Open or update the existing pull request with your changes once the task is complete. The title of
   the PR should include the task id. The PR description should include a
   summary of the changes made.
7. Update the prd.json file to reflect any changes in task states.
   - Add follow up tasks only if needed.
   - Append to the \`description\` field with any notes.
   - When a task is complete, set its \`stateId\` to the id that indicates
     a review is required, or completion if a review state is unavailable.

Remember, only work on a single task at a time, that you decide is the most
important to work on next.

## prd.json format

Each item in the prd.json file represents a task for the current project.

The \`stateId\` field indicates the current state of the task. The possible states
are:

${Array.from(linear.states.values(), (state) => `- **${state.name}** (stateId: \`${state.id}\`)`).join("\n")}

### Adding tasks

To add a new task, append a new item to the prd.json file with the id set to
\`null\`.

### prd.json json schema

\`\`\`json
${JSON.stringify(PrdIssue.jsonSchema, null, 2)}
\`\`\`
`

      return { prompt } as const
    }),
  },
) {
  static layer = Layer.effect(this, this.make).pipe(Layer.provide(Linear.layer))
}
