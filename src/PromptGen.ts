import { Effect, Layer, ServiceMap } from "effect"
import { PrdIssue } from "./domain/PrdIssue.ts"
import { CurrentIssueSource } from "./IssueSources.ts"

export class PromptGen extends ServiceMap.Service<PromptGen>()(
  "lalph/PromptGen",
  {
    make: Effect.gen(function* () {
      const sourceMeta = yield* CurrentIssueSource

      const prdNotes = `## prd.yml file

**Important:** Wait 5 seconds between edits to allow the system to update the prd.yml file.

Each item in the prd.yml file represents a task for the current project.

The \`state\` field indicates the current state of the task. The possible states
are:

- backlog
- todo
- in-progress
- in-review
- done

### Adding tasks

To add a new task, append a new item to the prd.yml file with the id set to
\`null\`.

When adding a new task, it will take about 5 seconds for the system to update the
prd.yml file with a new id for the task.

### Removing tasks

To remove a task, simply delete the item from the prd.yml file.

### prd.yml json schema

\`\`\`json
${JSON.stringify(PrdIssue.jsonSchema, null, 2)}
\`\`\``

      const promptChoose = `# Instructions

Your job is to choose the next task to work on from the prd.yml file. **DO NOT** implement the task yet.

The following instructions should be done without interaction or asking for permission.

1. Decide which single task to work on next from the prd.yml file. This should
   be the task YOU decide as the most important to work on next, not just the
   first task in the list.
   - Only start tasks that are in a "todo" state.
   - If the \`blockedBy\` field is not empty, skip the task.
2. **Before doing anything else**, mark the task as "in-progress" by updating its
   \`state\` in the prd.yml file.
   This prevents other people or agents from working on the same task simultaneously.
3. Research the task. If it seems like too many steps are needed to complete the task,
   break it down into smaller tasks and add them to the prd.yml file, marking the
   original task as "done" by updating its \`state\`.
4. Once you have chosen a task of reasonable size, save its information in a
   "task.json" file alongside the prd.yml file. Use the following format:

\`\`\`json
{
  "id": "task id",
}
\`\`\`

## Important: Task sizing

If at any point you decide that a task is too large or complex to complete in a
single iteration, break it down into smaller tasks and add them to the prd.yml
file. Then, mark the original task as "done" by updating its \`state\`.

Each task should be an atomic, commitable piece of work.
Instead of creating tasks like "Refactor the authentication system", create
smaller tasks like "Implement OAuth2 login endpoint", "Add JWT token refresh mechanism", etc.

${prdNotes}`

      const prompt = (options: {
        readonly taskId: string
        readonly targetBranch: string | undefined
      }) => `# Instructions

The following instructions should be done without interaction or asking for
permission.

1. Your job is to complete the task with id \`${options.taskId}\` from the prd.yml file.
2. Check if there is an existing Github PR for the task, otherwise create a new
   branch for the task.${options.targetBranch ? ` The target branch for the PR should be \`${options.targetBranch}\`. If the target branch does not exist, create it first.` : ""}
   - If there is an existing PR, checkout the branch for that PR.
   - If there is an existing PR, check if there are any new comments or requested
     changes, and address them as part of the task.
   - If creating a new branch, don't checkout any main branches first, use the current
     HEAD as the base.
   - New branches should be named using the format \`{task id}/description\`.
   - When checking for PR reviews, make sure to check the "reviews" field and read ALL unresolved comments.
4. Implement the task.
5. Run any checks / feedback loops, such as type checks, unit tests, or linting.
6. Create or update the pull request with your progress.
   ${sourceMeta.githubPrInstructions}
   The PR description should include a summary of the changes made.
   - None of the files in the \`.lalph\` directory should be committed.
   - You have permission to create or update the PR as needed. You have full
     permission to push branches, create PRs or create git commits.
7. Update the prd.yml file to reflect any changes in task states.
   - Update the prd.yml file after the GitHub PR has been created or updated.
   - Add follow up tasks only if needed.
   - Append to the \`description\` field with any notes or important discoveries.
   - If you believe the task is complete, update the \`state\` to "in-review".

## Handling blockers

If for any reason you get stuck on a task, mark the task back as "todo" by updating its
\`state\` and leaving some notes in the task's \`description\` field about the
challenges faced.

If it feels like you are brute forcing your way through a task, STOP and move the
task back to "todo" state with notes on why in the description.

${prdNotes}`

      const promptTimeout = (options: {
        readonly taskId: string
      }) => `# Instructions

Your earlier attempt to complete the task with id \`${options.taskId}\` took too
long and has timed out. You can find the task details in the prd.yml file.

The following instructions should be done without interaction or asking for
permission.

1. Investigate why you think the task took too long. Research the codebase
   further if needed.
2. Break down the task into smaller tasks and add them to the prd.yml file.
3. Mark the original task as "done" by updating its \`state\` in the prd.yml file.
4. Each new task should have an id of \`null\`, a title, and a concise description that
   includes a short summary of the task and a brief list of steps to complete it.
   - The tasks should start in the "todo" state.
   - Each task should be an atomic, commitable piece of work.
     Instead of creating tasks like "Refactor the authentication system", create
     smaller tasks like "Implement OAuth2 login endpoint", "Add JWT token refresh mechanism", etc.
5. Setup task dependencies using the \`blockedBy\` field as needed. You will need
   to wait 5 seconds after adding tasks to the prd.yml file to allow the system
   to assign ids to the new tasks before you can setup dependencies.

${prdNotes}`

      const planPrompt = `# Instructions

1. Ask the user for the idea / request, then break it down into multiple smaller tasks
   that can be added to the prd.yml file. If a plan already exists in "lalph-plan.md",
   then your job is to iterate on the existing plan by updating the existing tasks.
   - Make sure to research the codebase before creating any tasks, to ensure they
     are relevant and feasible.
   - Check if similar tasks already exist in the prd.yml file to avoid duplication.
2. Each task should have a id of \`null\`, a title, and a concise description that
   includes a short summary of the task and a brief list of steps to complete it.
   - The tasks should start in the "todo" state.
   - Each task should be an atomic, commitable piece of work.
     Instead of creating tasks like "Refactor the authentication system", create
     smaller tasks like "Implement OAuth2 login endpoint", "Add JWT token refresh mechanism", etc.
3. Add the new tasks to the prd.yml file.
4. Wait until the tasks are saved, then setup task dependencies using the \`blockedBy\` field.
5. Add a outline of the plan to a "lalph-plan.md" file, that will help guide future iterations.

**Important:** You are only creating or updating the plan, not implementing any tasks yet.
 
${prdNotes}`

      return { promptChoose, prompt, promptTimeout, planPrompt } as const
    }),
  },
) {
  static layer = Layer.effect(this, this.make)
}
