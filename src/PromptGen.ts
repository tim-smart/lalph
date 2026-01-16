import { Effect, Layer, ServiceMap } from "effect"
import { PrdIssue } from "./domain/PrdIssue.ts"
import { IssueSource } from "./IssueSource.ts"
import { CurrentIssueSource } from "./IssueSources.ts"

export class PromptGen extends ServiceMap.Service<PromptGen>()(
  "lalph/PromptGen",
  {
    make: Effect.gen(function* () {
      const sourceMeta = yield* CurrentIssueSource
      const source = yield* IssueSource
      const states = yield* source.states

      const prdNotes = `## prd.json format

Each item in the prd.json file represents a task for the current project.

The \`stateId\` field indicates the current state of the task. The possible states
are:

${Array.from(states.values(), (state) => `- **${state.name}** (stateId: \`${state.id}\`)`).join("\n")}

### Adding tasks

To add a new task, append a new item to the prd.json file with the id set to
\`null\`.

When adding a new task, it will take about 5 seconds for the system to update the
prd.json file with a new id for the task.

### Removing tasks

To remove a task, simply delete the item from the prd.json file.

### prd.json json schema

\`\`\`json
${JSON.stringify(PrdIssue.jsonSchema, null, 2)}
\`\`\``

      const prompt = `# Instructions

The following instructions should be done without interaction or asking for
permission.

1. Decide which single task to work on next from the prd.json file. This should
   be the task YOU decide as the most important to work on next, not just the
   first task in the list.
   - If a task is already completed or in review, skip it.
   - If the \`blockedBy\` field is not empty, skip the task.
2. **Before doing anything else**, mark the task as "in progress" by updating its
   \`stateId\` in the prd.json file.
   This prevents other people or agents from working on the same task simultaneously.
3. Check if there is an existing Github PR for the task, otherwise create a new
   branch for the task.
   - If there is an existing PR, checkout the branch for that PR.
   - If there is an existing PR, check if there are any new comments or requested
     changes, and address them as part of the task.
   - New branches should be named using the format \`{task id}/description\`.
   - When checking for PR reviews, make sure to check the "reviews" field and read ALL unresolved comments.
4. Research the task. If it seems like too many steps are needed to complete the task,
   break it down into smaller tasks and add them to the prd.json file, marking the
   original task as "blocked" or "closed" by updating its \`stateId\`.
   Otherwise, implement the task.
5. Run any checks / feedback loops, such as type checks, unit tests, or linting.
6. Create or update the pull request with your progress.
   ${sourceMeta.githubPrInstructions}
   The PR description should include a summary of the changes made.
   - None of the files in the \`.lalph\` directory should be committed.
   - You have permission to create or update the PR as needed. No need to ask for
     permission to push branches or create PRs.
7. Update the prd.json file to reflect any changes in task states.
   - Add follow up tasks only if needed.
   - Append to the \`description\` field with any notes or important discoveries.
   - If you believe the task is complete, update the \`stateId\` for "review".
     Only if no "review" state exists, use a completed state.

Remember, only work on a single task at a time, that you decide is the most
important to work on next.

## Important: Task sizing

If at any point you decide that a task is too large or complex to complete in a
single iteration, break it down into smaller tasks and add them to the prd.json
file. Then, mark the original task as "blocked" or "deferred" by updating its
\`stateId\`.

Each task should be small and specific.
Instead of creating tasks like "Refactor the authentication system", create
smaller tasks like "Implement OAuth2 login endpoint", "Add JWT token refresh mechanism", etc.

## Handling blockers

If for any reason you get stuck on a task, mark the task back as "todo" by updating its
\`stateId\` and leaving some notes in the task's \`description\` field about the
challenges faced.

If it feels like you are brute forcing your way through a task, STOP and move the
task back to "todo" state with notes on why in the description.

${prdNotes}`

      const planPrompt = (idea: string) => `# Instructions

Users idea / request: ${idea}

1. For the users idea / request above, break it down into multiple smaller tasks
   that can be added to the prd.json file.
   - Make sure to research the codebase before creating any tasks, to ensure they
     are relevant and feasible.
   - Check if similar tasks already exist in the prd.json file to avoid duplication.
2. Each task should have a id of \`null\`, a title, and a concise description that
   includes a short summary of the task and a brief list of steps to complete it.
   - The tasks should start in a "Todo" state (i.e., not started yet).
   - Each task should be small and specific.
     Instead of creating tasks like "Refactor the authentication system", create
     smaller tasks like "Implement OAuth2 login endpoint", "Add JWT token refresh mechanism", etc.
3. Add the new tasks to the prd.json file.
4. Add a brief outline of the plan to a "lalph-plan.md" file, that will help guide future
   iterations.
 
${prdNotes}`

      const planContinuePrompt = `# Instructions

1. Review the existing prd.json file and lalph-plan.md file to understand the current
   plan and tasks.
2. Ask the user for feedback to iterate on the existing plan.

## Creating / updating tasks

- Each task should have a id of \`null\`, a title, and a concise description that
  includes a short summary of the task and a brief list of steps to complete it.
  - The tasks should start in a "Todo" state (i.e., not started yet).
  - Each task should be small and specific.
    Instead of creating tasks like "Refactor the authentication system", create
    smaller tasks like "Implement OAuth2 login endpoint", "Add JWT token refresh mechanism", etc.
- Add / update the brief outline of the plan in the "lalph-plan.md" file, that will help guide future
  iterations.
 
${prdNotes}`

      return { prompt, planPrompt, planContinuePrompt } as const
    }),
  },
) {
  static layer = Layer.effect(this, this.make)
}
