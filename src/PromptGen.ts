import { Effect, FileSystem, Layer } from "effect"
import { Linear } from "./Linear.ts"
import { PrdIssue } from "./Prd.ts"

export const PromptGen = Layer.effectDiscard(
  Effect.gen(function* () {
    const linear = yield* Linear
    const fs = yield* FileSystem.FileSystem

    yield* Effect.scoped(
      fs.open(".lalph/progress.md", {
        flag: "a+",
      }),
    )

    yield* fs.writeFileString(
      ".lalph/prompt.md",
      `@prd.json @progress.md

# Instructions

1. Decide which single task to work on next from the prd.json file. This should
   be the task YOU decide as the most important to work on next, not just the
   first task in the list.
2. Run any checks / feedback loops, such as type checks, unit tests, or linting.
3. APPEND your progress to the progress.md file.
4. Make a git commit when you have made significant progress or completed the task.
5. Update the prd.json file to reflect any changes in task states.
   - Add follow up tasks only if needed.
   - Update the \`description\` field with any notes.
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
`,
    )
  }),
).pipe(Layer.provide(Linear.layer))
