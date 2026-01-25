import { Effect, Layer, ServiceMap } from "effect"
import { PrdIssue } from "./domain/PrdIssue.ts"
import { CurrentIssueSource } from "./IssueSources.ts"

export class PromptGen extends ServiceMap.Service<PromptGen>()(
  "lalph/PromptGen",
  {
    make: Effect.gen(function* () {
      const sourceMeta = yield* CurrentIssueSource

      const prdNotes = (options?: {
        readonly specsDirectory?: string | undefined
      }) => `## prd.yml file

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

#### Task creation guidelines

**Important**: When creating tasks, make sure each task is independently shippable
without failing validation checks (typechecks, linting, tests). If a task would only
pass validations when combined with another, combine the work into one task.

Each task should be an atomic, committable piece of work.
Instead of creating tasks like "Refactor the authentication system", create
smaller tasks like "Implement OAuth2 login endpoint", "Add JWT token refresh mechanism", etc.${
        options?.specsDirectory
          ? `

If you need to add a research task, mention in the description that it needs to:
- add a specification file in the \`${options.specsDirectory}\` directory.
- add follow up tasks in the prd.yml file based on the new specification. The tasks
 should reference the specification file in their description.
- make sure the follow up tasks include a dependency on the research task.`
          : ""
      }

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
   - You **cannot** start tasks unless they have an empty \`blockedBy\` field.
2. **Before doing anything else**, mark the task as "in-progress" by updating its
   \`state\` in the prd.yml file.
   This prevents other people or agents from working on the same task simultaneously.
3. Check if there is an existing Github PR for the chosen task. If there is, note the PR number for inclusion in the task.json file.
4. Once you have chosen a task, save its information in a "task.json" file alongside
   the prd.yml file. Use the following format:

\`\`\`json
{
  "id": "task id",
  "githubPrNumber": null
}
\`\`\`
Set \`githubPrNumber\` to the PR number if one exists, otherwise use \`null\`.

${prdNotes()}`

      const prompt = (options: {
        readonly taskId: string
        readonly targetBranch: string | undefined
        readonly specsDirectory: string
        readonly githubPrNumber: number | undefined
      }) => `The following instructions should be done without interaction or asking for permission.

1. Study the ${options.specsDirectory}/README.md file (if available).
   Then your job is to complete the task with id \`${options.taskId}\` from the prd.yml file.
   Read the entire prd.yml file to understand the context of the task and any key learnings from previous work.
2. ${
        options.githubPrNumber
          ? `The Github PR #${options.githubPrNumber} has been detected for this task and the branch has been checked out.
   - Review feedback in the .lalph/feedback.md file (same folder as the prd.yml file).`
          : `Create a new branch for the task using the format \`{task id}/description\`, using the current HEAD as the base (don't checkout any other branches first).`
      }
3. Implement the task.
   - If this task is a research task, **do not** make any code changes yet.
   - If this task is a research task and you add follow-up tasks, include this tasks id in each new tasks \`blockedBy\` field.
   - **If at any point** you discover something that needs fixing, or another task
     that needs doing, immediately add it to the prd.yml file as a new task unless
     you plan to fix it as part of this task.
   - Add important discoveries about the codebase, or challenges faced to the task's
     \`description\`. More details below.
4. Run any checks / feedback loops, such as type checks, unit tests, or linting.
5. ${!options.githubPrNumber ? `Create a pull request for this task.${options.targetBranch ? ` The target branch for the PR should be \`${options.targetBranch}\`. If the target branch does not exist, create it first.` : ""}` : "Update the pull request with your progress."}
   ${sourceMeta.githubPrInstructions}
   The PR description should include a summary of the changes made.
   - **DO NOT** commit any of the files in the \`.lalph\` directory.
   - You have permission to create or update the PR as needed. You have full permission to push branches, create PRs or create git commits.
6. Update the prd.yml file to reflect any changes in task states.
   - Update the prd.yml file after the GitHub PR has been created or updated.
   - Rewrite the notes in the description to include only the key discoveries and information that could speed up future work on other tasks.
   - If you believe the task is complete, update the \`state\` to "in-review".

## Important: Adding new tasks

**If at any point** you discover something that needs fixing, or another task
that needs doing, immediately add it to the prd.yml file as a new task.

Read the "### Adding tasks" section below carefully for guidelines on creating tasks.

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

${prdNotes(options)}`

      const promptTimeout = (options: {
        readonly taskId: string
        readonly specsDirectory: string
      }) => `Your earlier attempt to complete the task with id \`${options.taskId}\` took too
long and has timed out. You can find the task details in the prd.yml file.

The following instructions should be done without interaction or asking for
permission.

1. Investigate why you think the task took too long. Research the codebase
   further to understand what is needed to complete the task.
2. Mark the original task as "done" by updating its \`state\` in the prd.yml file.
3. Break down the task into smaller tasks and add them to the prd.yml file.
   Read the "### Adding tasks" section below **extremely carefully** for guidelines on creating tasks.
4. Setup task dependencies using the \`blockedBy\` field as needed. You will need
   to wait 5 seconds after adding tasks to the prd.yml file to allow the system
   to assign ids to the new tasks before you can setup dependencies.
5. If any specifications need updating based on your new understanding, update them.

${prdNotes(options)}`

      const planPrompt = (options: {
        readonly specsDirectory: string
      }) => `1. Ask the user for the idea / request, then your job is to create a detailed
   specification to fulfill the request and save it as a file.
   First do some research to understand the request, then interview the user
   to gather all the necessary requirements and details for the specification.
2. Once you have saved the specification, your next job is to create an implementation
   plan by breaking down the specification into smaller, manageable tasks and add
   them to the prd.yml file.
   For each task include in the description where to find the plan specification.
   Read the "### Adding tasks" section below **extremely carefully** for guidelines on creating tasks.
3. Wait until the tasks are saved, then setup task dependencies using the \`blockedBy\` field.
4. Start a subagent with a copy of this prompt, to review the plan and provide feedback or improvements.
5. Present the saved specification for review (include the full text in your response).
   If any corrections are needed, update the specification and adjust the plan tasks accordingly.

**Important:** You are only creating or updating a plan, not implementing any tasks yet.

## Specifications

- Should go into a \`${options.specsDirectory}\` directory, with a filename that reflects the
  project name.
- When adding a new specification, add a link to it in the README.md file in the
  \`${options.specsDirectory}\` directory, along with a brief overview of the specification.
  If the README.md file does not exist, create it.
 
${prdNotes(options)}`

      return { promptChoose, prompt, promptTimeout, planPrompt } as const
    }),
  },
) {
  static layer = Layer.effect(this, this.make)
}
