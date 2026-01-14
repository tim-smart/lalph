import { Effect, Layer, ServiceMap } from "effect"
import { PrdIssue } from "./domain/PrdIssue.ts"
import { IssueSource } from "./IssueSource.ts"

export class PromptGen extends ServiceMap.Service<PromptGen>()(
  "lalph/PromptGen",
  {
    make: Effect.gen(function* () {
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

### prd.json json schema

\`\`\`json
${JSON.stringify(PrdIssue.jsonSchema, null, 2)}
\`\`\``

      const prompt = `# Instructions

1. Decide which single task to work on next from the prd.json file. This should
   be the task YOU decide as the most important to work on next, not just the
   first task in the list. You can use the PROGRESS.md file to help inform your
   decision.
   - If a task is already completed or in review, skip it.
   - If a task is blocked by another task, skip it.
2. **Before doing anything else**, mark the task as "in progress" by updating its
   \`stateId\` in the prd.json file.
   This prevents other people or agents from working on the same task simultaneously.
3. Decide if this task is too large or complex to complete in a single iteration.
   If so, break it down into smaller tasks and add them to the prd.json file.
   Then, mark the original task as "blocked" or "deferred" by updating its
   \`stateId\`.
   - More information on task sizing is provided below.
   - You can skip the rest of the instructions for this iteration if you break down
     the task.
4. Check if there is an existing Github PR for the task, otherwise create a new
   branch for the task.
   - If there is an existing PR, checkout the branch for that PR.
   - If there is an existing PR, check if there are any new comments or requested
     changes, and address them as part of the task.
   - New branches should be named using the format \`{task id}/description\`.
   - When checking for PR reviews, make sure to check the "reviews" field and read ALL unresolved comments.
5. Implement the task.
6. Run any checks / feedback loops, such as type checks, unit tests, or linting.
7. APPEND your progress to the PROGRESS.md file. Include:
   - Key decisions made and reasoning
   - Files changed
   - Any blockers or notes for next iteration
   Keep entries concise. Sacrifice grammar for the sake of concision.
   This file helps future iterations skip exploration.
8. Create or update the pull request with your progress. The title of
   the PR should include the task id. The PR description should include a
   summary of the changes made.
   - None of the files in the \`.lalph\` directory should be committed.
9. Update the prd.json file to reflect any changes in task states.
   - Add follow up tasks only if needed.
   - Append to the \`description\` field with any notes.
   - If you believe the task is complete, update the \`stateId\` for "review".
     Only if no "review" state exists, use a completed state.

Remember, only work on a single task at a time, that you decide is the most
important to work on next.

## Important: Task sizing

If at any point you decide that a task is too large or complex to complete in a
single iteration, break it down into smaller tasks and add them to the prd.json
file. Then, mark the original task as "blocked" or "deferred" by updating its
\`stateId\`.

Each task should be small and take a hour or less to complete.
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
2. Each task should have a id of \`null\`, a title, and a concise description of what
   needs to be done.
   - The tasks should start in a backlog state (i.e., not started yet).
   - The tasks should be actionable and specific, avoiding vague or high-level
     descriptions.
   - Each task should be small and take a hour or less to complete.
     Instead of creating tasks like "Refactor the authentication system", create
     smaller tasks like "Implement OAuth2 login endpoint", "Add JWT token refresh mechanism", etc.
3. Add the new tasks to the prd.json file.
4. Add a brief outline of the plan to a "lalph-plan.md" file, that will help guide future
   iterations.
 
${prdNotes}`

      const planPromptFollowup = (feedback: string) => `# Instructions

Users feedback on plan: ${feedback}

1. Review the existing plan in the prd.json and lalph-plan.md files.
2. Based on the user's feedback above, update the plan as needed by adding,
   removing, or modifying tasks in the prd.json file.
   - The tasks should start in a backlog state (i.e., not started yet).
   - The tasks should be actionable and specific, avoiding vague or high-level
     descriptions.
   - Each task should be small and take a hour or less to complete.
     Instead of creating tasks like "Refactor the authentication system", create
     smaller tasks like "Implement OAuth2 login endpoint", "Add JWT token refresh mechanism", etc.
3. Update the lalph-plan.md file to reflect any changes made to the plan.
4. Ensure that the tasks remain actionable and specific, avoiding vague or
   high-level descriptions.

${prdNotes}`

      return { prompt, planPrompt, planPromptFollowup } as const
    }),
  },
) {
  static layer = Layer.effect(this, this.make)
}
