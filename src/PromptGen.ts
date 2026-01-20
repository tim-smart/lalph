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
\`null\`, a title, state set to "todo", and a concise description that includes
a short summary of the task and a brief list of steps to complete it.

When adding a new task, it will take about 5 seconds for the system to update the
prd.yml file with a new id for the task.

After adding a new task, you can setup dependencies using the \`blockedBy\` field

### Removing tasks

To remove a task, simply delete the item from the prd.yml file.

### prd.yml json schema

\`\`\`json
${JSON.stringify(PrdIssue.jsonSchema, null, 2)}
\`\`\``

      const promptChoose = `Your job is to choose the next task to work on from the prd.yml file. **DO NOT** implement the task yet.

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

${prdNotes}`

      const prompt = (options: {
        readonly taskId: string
        readonly targetBranch: string | undefined
      }) => `The following instructions should be done without interaction or asking for permission.

1. Your job is to complete the task with id \`${options.taskId}\` from the prd.yml file.
   Read the entire prd.yml file to understand the context of the task and any
   key learnings from previous work. Study the .specs/README.md file.
2. Check if there is an existing Github PR for the task, otherwise create a new
   branch for the task.${options.targetBranch ? ` The target branch for the PR should be \`${options.targetBranch}\`. If the target branch does not exist, create it first.` : ""}
   - If there is an existing PR, checkout the branch for that PR.
   - If there is an existing PR, check if there are any new comments or requested
     changes, and address them as part of the task.
   - If creating a new branch, don't checkout any main branches first, use the current
     HEAD as the base.
   - New branches should be named using the format \`{task id}/description\`.
   - When checking for PR reviews, make sure to check the "reviews" field and read ALL unresolved comments.
     Also read the normal comments to see if there are any additional requests.
3. Implement the task.
4. Run any checks / feedback loops, such as type checks, unit tests, or linting.
5. Create or update the pull request with your progress.
   ${sourceMeta.githubPrInstructions}
   The PR description should include a summary of the changes made.
   - **DO NOT** commit any of the files in the \`.lalph\` directory.
   - You have permission to create or update the PR as needed. You have full
     permission to push branches, create PRs or create git commits.
6. Update the prd.yml file to reflect any changes in task states.
   - Update the prd.yml file after the GitHub PR has been created or updated.
   - Rewrite the notes in the description to include only the key discoveries
     and information that could speed up future work on other tasks.
   - If you believe the task is complete, update the \`state\` to "in-review".

## Important: Adding new tasks

**If at any point** you discover something that needs fixing, or another task
that needs doing, immediately add it to the prd.yml file as a new task.

## Important: Recording key information

This session will time out after a certain period, so make sure to record
key information that could speed up future work on the task in the description.
Record the information **in the moment** as you discover it,
do not wait until the end of the task. Things to record include:

- Important discoveries about the codebase.
- Any challenges faced and how you overcame them. For example:
  - If it took multiple attempts to get something working, record what worked.
  - If you found a library api was renamed or moved, record the new name.
- Any other information that could help future work on similar tasks.

## Handling blockers

If for any reason you get stuck on a task, mark the task back as "todo" by updating its
\`state\` and leaving some notes in the task's \`description\` field about the
challenges faced.

If it feels like you are brute forcing your way through a task, STOP and move the
task back to "todo" state with notes on why in the description.

${prdNotes}`

      const promptTimeout = (options: {
        readonly taskId: string
      }) => `Your earlier attempt to complete the task with id \`${options.taskId}\` took too
long and has timed out. You can find the task details in the prd.yml file.

The following instructions should be done without interaction or asking for
permission.

1. Investigate why you think the task took too long. Research the codebase
   further if needed.
2. Break down the task into smaller tasks and add them to the prd.yml file.
3. Mark the original task as "done" by updating its \`state\` in the prd.yml file.
4. Each new task should have an id of \`null\`, a title, and a concise description that
   includes a short summary of the task and a brief list of steps to complete it.
   - Include where to find the plan specification in the description (if applicable).
   - The tasks should start in the "todo" state.
   - Each task should be an atomic, committable piece of work.
     Instead of creating tasks like "Refactor the authentication system", create
     smaller tasks like "Implement OAuth2 login endpoint", "Add JWT token refresh mechanism", etc.
5. Setup task dependencies using the \`blockedBy\` field as needed. You will need
   to wait 5 seconds after adding tasks to the prd.yml file to allow the system
   to assign ids to the new tasks before you can setup dependencies.

${prdNotes}`

      const planPrompt = (options: {
        readonly specsDirectory: string
      }) => `1. Ask the user for the idea / request, then your job is to create a detailed
   specification to fulfill the request and save it as a file. Interview the user
   to gather all the necessary requirements and details for the specification.
2. Once you have saved the specification, your next job is to create an implementation
   plan by breaking down the specification into smaller, manageable tasks and add
   them to the prd.yml file.
   Each task include in the description where to find the plan specification.
   - Each task should be an atomic, committable piece of work.
     Instead of creating tasks like "Refactor the authentication system", create
     smaller tasks like "Implement OAuth2 login endpoint", "Add JWT token refresh mechanism", etc.
   - If you need to add a research task, mention in the description that it needs to:
     - add a specification file in the \`${options.specsDirectory}\` directory.
     - add follow up tasks in the prd.yml file based on the new specification. The tasks
       should reference the specification file in their description.
3. Wait until the tasks are saved, then setup task dependencies using the \`blockedBy\` field.
4. Start a subagent with a copy of this prompt, to review the plan and provide feedback or improvements.

**Important:** You are only creating or updating a plan, not implementing any tasks yet.

## Specifications

- Should go into a \`${options.specsDirectory}\` directory, with a filename that reflects the
  project name.
- When adding a new specification, add a link to in the README.md file in the
  \`${options.specsDirectory}\` directory along with a brief overview of the specification.
  If the README.md file does not exist, create it.
 
${prdNotes}`

      return { promptChoose, prompt, promptTimeout, planPrompt } as const
    }),
  },
) {
  static layer = Layer.effect(this, this.make)
}
