import { Effect, Layer, ServiceMap } from "effect"
import { PrdIssue } from "./domain/PrdIssue.ts"
import { CurrentIssueSource } from "./CurrentIssueSource.ts"
import type { GitFlow } from "./GitFlow.ts"

export class PromptGen extends ServiceMap.Service<PromptGen>()(
  "lalph/PromptGen",
  {
    make: Effect.gen(function* () {
      const sourceMeta = yield* CurrentIssueSource

      const prdNotes = (options?: {
        readonly specsDirectory?: string | undefined
      }) => `## prd.yml file

**Important:** Wait 5 seconds between edits to allow the system to update the prd.yml file.
If adding more than 10 tasks, wait 10 seconds.
You only need to wait if working with the prd.yml file directly, not any other files.

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

${taskGuidelines(options)}

### Removing tasks

To remove a task, simply delete the item from the prd.yml file.

### prd.yml json schema

\`\`\`json
${JSON.stringify(PrdIssue.jsonSchema, null, 2)}
\`\`\``

      const promptChoose = (options: {
        readonly gitFlow: GitFlow["Service"]
      }) => `Your job is to choose the next task to work on from the prd.yml file and save it in a task.json file.
**DO NOT** implement the task yet.

The following instructions should be done without interaction or asking for permission.

- Decide which single task to work on next from the prd.yml file. This should
  be the task YOU decide as the most important to work on next, not just the
  first task in the list.
  - Only start tasks that are in a "todo" state.
  - You **cannot** start tasks unless they have an empty \`blockedBy\` field.${
    options.gitFlow.requiresGithubPr
      ? `
- Check if there is an open Github PR for the chosen task. If there is, note the PR number for inclusion in the task.json file.
  - If the task mentions a pull request, then use that instead
  - Only include "open" PRs that are not yet merged.
  - The pull request will contain the task id in the title or description.`
      : ""
  }
- Once you have chosen a task, save its information in a "task.json" file alongside
  the prd.yml file. Use the following format:

\`\`\`json
{
  "id": "task id",
  "githubPrNumber": null
}
\`\`\`${
        options.gitFlow.requiresGithubPr
          ? `

Set \`githubPrNumber\` to the PR number if one exists, otherwise use \`null\`.
`
          : "\n\nLeave `githubPrNumber` as null."
      }
`

      const promptChooseClanka = (options: {
        readonly gitFlow: GitFlow["Service"]
      }) => `- Use the "listEligibleTasks" function to view the list of tasks that you can start working on.
  - **NO NOT PARSE THE yaml OUTPUT IN ANY WAY**
  - **DO NOT** implement the task yet.
  - **DO NOT** use the "delegate" function for any step in this workflow
- After reading through the list of tasks, choose the task to work on. This should
  be the task YOU decide as the most important to work on next, not just the
  first task in the list.${
    options.gitFlow.requiresGithubPr
      ? `
- Check if there is an open Github PR for the chosen task. If there is, note the PR number for inclusion when calling "chooseTask".
  - If the task mentions a pull request, then use that instead
  - Only include "open" PRs that are not yet merged.
  - The pull request will contain the task id in the title or description.`
      : ""
  }
- Use the "chooseTask" function to select the task you have chosen.
${
  options.gitFlow.requiresGithubPr
    ? `\n  - Set \`githubPrNumber\` to the PR number if one exists, otherwise use \`null\`.`
    : "\n  Leave `githubPrNumber` as null."
}
`
      const promptChooseRalph = (options: {
        readonly specFile: string
      }) => `- Read the spec file at \`${options.specFile}\` to understand the current project.
- Choose the next most important task to work on from the specification.
- If all of the tasks are complete then do nothing more. Otherwise, write the chosen task in a ".lalph/task.md" file.

Note: The task should be a specific, actionable item that can be completed in a reasonable amount of time.
`

      const keyInformation = (options: {
        readonly specsDirectory: string
      }) => `## Important: Recording key information

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

      const systemClanka = (options: {
        readonly specsDirectory: string
      }) => `## Important: Recording key information

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

${taskGuidelines(options)}`

      const prompt = (options: {
        readonly task: PrdIssue
        readonly targetBranch: string | undefined
        readonly specsDirectory: string
        readonly githubPrNumber: number | undefined
        readonly gitFlow: GitFlow["Service"]
      }) => `# ${options.task.title}

Task ID: ${options.task.id}

${options.task.description}

### Instructions

Your job is to implement the task described above.${
        options.task.description.includes(options.specsDirectory)
          ? `\nMake sure to review the prd.yml for any key information that may help you with this task.`
          : ""
      }

1. ${options.gitFlow.setupInstructions(options)}
2. Implement the task.
   - If this task is a research task, **do not** make any code changes yet.
   - If this task is a research task and you add follow-up tasks, include (at least) "${options.task.id}" in the new task's \`blockedBy\` field.
   - **If at any point** you discover something that needs fixing, or another task
     that needs doing, immediately add it to the prd.yml file as a new task unless
     you plan to fix it as part of this task.
   - Add important discoveries about the codebase, or challenges faced to the task's
     \`description\`. More details below.
3. Run any checks / feedback loops, such as type checks, unit tests, or linting.
4. ${options.gitFlow.commitInstructions({
        githubPrInstructions: sourceMeta.githubPrInstructions,
        githubPrNumber: options.githubPrNumber,
        taskId: options.task.id ?? "unknown",
        targetBranch: options.targetBranch,
      })}
5. **After ${options.gitFlow.requiresGithubPr ? "pushing" : "committing"}** your changes, update the prd.yml to reflect any changes in the task state.
   - Rewrite the notes in the description to include only the key discoveries and information that could speed up future work on other tasks. Make sure to preserve important information such as specification file references.
   - If you believe the task is complete, update the \`state\` to "in-review".

${keyInformation(options)}`

      const promptClanka = (options: {
        readonly task: PrdIssue
        readonly targetBranch: string | undefined
        readonly specsDirectory: string
        readonly githubPrNumber: number | undefined
        readonly gitFlow: GitFlow["Service"]
      }) => `# ${options.task.title}

Task ID: ${options.task.id}

${options.task.description}

### Instructions

All steps must be done before the task can be considered complete.${
        options.task.description.includes(options.specsDirectory)
          ? `\nMake sure to review the previous tasks (using "listTasks") for any key information that may help you with this task.`
          : ""
      }

1. ${options.gitFlow.setupInstructions(options)}
2. Implement the task.
   - If this task is a research task, **do not** make any code changes yet.
   - If this task is a research task and you add follow-up tasks, include (at least) "${options.task.id}" in the new task's \`blockedBy\` field.
   - Add important discoveries about the codebase, or challenges faced to the task's
     \`description\`. More details below.
3. Run any checks / feedback loops, such as type checks, unit tests, or linting.
4. ${options.gitFlow.commitInstructions({
        githubPrInstructions: sourceMeta.githubPrInstructions,
        githubPrNumber: options.githubPrNumber,
        taskId: options.task.id ?? "unknown",
        targetBranch: options.targetBranch,
      })}
5. **After ${options.gitFlow.requiresGithubPr ? "pushing" : "committing"}** your changes, update current task to reflect any changes in the task state.
   - Rewrite the notes in the description to include only the key discoveries and information that could speed up future work on other tasks. Make sure to preserve important information such as specification file references.
   - If you believe the task is complete, update the \`state\` to "in-review".`

      const promptRalph = (options: {
        readonly task: string
        readonly targetBranch: string | undefined
        readonly specFile: string
        readonly gitFlow: GitFlow["Service"]
      }) => `${options.task}

## Project specification

Make sure to review the project specification at \`${options.specFile}\` for any key information that may help you with this task.

### Instructions

All steps must be done before the task can be considered complete.

1. ${options.gitFlow.setupInstructions({ githubPrNumber: undefined })}
2. Implement the task.
  - Along the way, update the specification file with any important discoveries or issues found.
3. Run any checks / feedback loops, such as type checks, unit tests, or linting.
4. Update the specification implementation plan at \`${options.specFile}\` to reflect changes to task states.
4. ${options.gitFlow.commitInstructions({
        githubPrInstructions: sourceMeta.githubPrInstructions,
        githubPrNumber: undefined,
        taskId: "unknown",
        targetBranch: options.targetBranch,
      })}
`

      const promptResearch = (options: {
        readonly task: PrdIssue
      }) => `Your job is to gather all the necessary information and details to complete the task described below. Do not make any code changes yet, your job is just to research and gather information.

In the final report:

- Include key file names, line numbers, and code snippets that are relevant to the task.
- Any key discoveries that will help with implementing the task.
- Any other information that will help speed up the implementation of the task.
- You DO NOT need to add your report to the task description, just include it in your final output.

# Task details

ID: ${options.task.id}
Title: ${options.task.title}

${options.task.description}`

      const promptReview = (options: {
        readonly prompt: string
        readonly gitFlow: GitFlow["Service"]
      }) => `A previous engineer has completed a task from the instructions below.

You job is to meticulously review their work to ensure it meets the task requirements,
follows best practices, and maintains high code quality. You should be extremely thorough
in your review, looking for any potential issues or improvements.

Once you have completed your review, you should:

- Make any code changes needed to fix issues you find.
- Add follow-up tasks for any work that could not be done, or for remaining issues that need addressing.

${options.gitFlow.reviewInstructions}

**Everything should be done without interaction or asking for permission.**

# Previous instructions (only for context, do not repeat)

${options.prompt}`

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

      const promptTimeoutRalph = (options: {
        readonly task: string
        readonly specFile: string
      }) => `Your earlier attempt to complete the following task took too
long and has timed out.

The following instructions should be done without interaction or asking for
permission.

1. Investigate why you think the task took too long. Research the codebase
   further to understand what is needed to complete the task.
2. Update the specification file at \`${options.specFile}\` to break the task
   down into smaller tasks, and include any important discoveries from your research.
3. Commit the changes to the specification file without pushing.
`

      const promptTimeoutClanka = (options: {
        readonly taskId: string
        readonly specsDirectory: string
      }) => `Your earlier attempt to complete the task with id \`${options.taskId}\` took too
long and has timed out.

The following instructions should be done without interaction or asking for
permission.

1. Investigate why you think the task took too long. Research the codebase
   further to understand what is needed to complete the task.
2. Mark the original task as "done" by updating its \`state\`.
3. Break down the task into smaller tasks and add them to the task list.
   Read the "### Adding tasks" section below **extremely carefully** for guidelines on creating tasks.
   - Make sure to setup task dependencies using the \`blockedBy\` field as needed.
5. If any specifications need updating based on your new understanding, update them.`

      const planPrompt = (options: {
        readonly plan: string
        readonly specsDirectory: string
      }) => `<request>
${options.plan}
</request>

## Instructions

1. Your job is to create a detailed specification to fulfill the request and save it as a file.
   First do some research to understand the request, then interview the user
   to gather all the necessary requirements and details for the specification.
   - If the user asks you to update an existing specification, find the relevant
     specification file in the \`${options.specsDirectory}\` directory and update it
     accordingly.
   - When interviewing the user, ask one question at a time about anything that
     needs clarification.
2. Add a detailed implementation plan to the specification, breaking down the work into
   smaller, manageable tasks.
3. Start two subagents to review the plan:
   - The first subagent will recieve the following prompt:
     \`\`\`
     Your job is to thoroughly review the specification created for the request,
     recommend improvements, and ensure every detail is covered.

     Below is the original request.

     ---

     {insert original prompt here}
     \`\`\`

   - The second subagent will receive the following prompt:
     \`\`\`
     Your job is to look over the implementation plan, and ensure each task is
     small, atomic and independently shippable. You also **NEED TO** make sure task
     can be completed without failing validation checks (typechecks, linting, tests).
     If a task will only pass validations when combined with another, the subagent should
     combine the work into one task.

     Below is the original request.

     ---

     {insert original prompt here}
     \`\`\`

4. Write the specification details to a \`.lalph/plan.json\` file using the following format:
   \`\`\`json
   {
     "specification": "path/to/specification/file.md"
   }
   \`\`\`
5. Present the full path to the specification file for review.

**Important:** You are only creating or updating a plan, not implementing any tasks yet.

## Specifications

- Should go into a \`${options.specsDirectory}\` directory, with a filename that reflects the
  project name.
- When adding a new specification, add a link to it in the README.md file in the
  \`${options.specsDirectory}\` directory, along with a brief overview of the specification.
  If the README.md file does not exist, create it.`

      const promptPlanTasks = (options: {
        readonly specsDirectory: string
        readonly specificationPath: string
      }) => `Your job is to convert the implementation plan in the specification file at
\`${options.specificationPath}\` into tasks in the prd.yml file. Read the "### Adding tasks"
section below extremely carefully for guidelines on creating tasks.

Before starting, read the entire prd.yml file to understand the context of existing tasks
and to ensure you do not create duplicate tasks.

Make sure each task is small, atomic and independently shippable without failing
validation checks (typechecks, linting, tests).
Each task should include a reference to the specification file in its description.

Once you have added all the tasks from the implementation plan into the prd.yml file,
setup dependencies between the tasks using the \`blockedBy\` field.

**Important:** You are only creating or updating a plan, not implementing any tasks yet.
 
${prdNotes(options)}`

      const promptPlanTasksClanka = (options: {
        readonly specsDirectory: string
        readonly specificationPath: string
      }) => `Your job is to convert the implementation plan in the specification file at
\`${options.specificationPath}\` into tasks.

Before starting, read the entire task list to understand the context of existing tasks
and to ensure you do not create duplicate tasks.

Make sure each task is small, atomic and independently shippable without failing
validation checks (typechecks, linting, tests).
Each task should include a reference to the specification file in its description.

Make sure to setup dependencies between the tasks using the \`blockedBy\` field.

**Important:** You are only creating or updating a plan, not implementing any tasks yet.`

      return {
        promptChoose,
        promptChooseClanka,
        promptChooseRalph,
        prompt,
        promptRalph,
        promptClanka,
        promptResearch,
        promptReview,
        promptTimeout,
        promptTimeoutClanka,
        promptTimeoutRalph,
        planPrompt,
        promptPlanTasks,
        promptPlanTasksClanka,
        systemClanka,
      } as const
    }),
  },
) {
  static layer = Layer.effect(this, this.make).pipe(
    Layer.provide(CurrentIssueSource.layer),
  )
}

const taskGuidelines = (options?: {
  readonly specsDirectory?: string | undefined
}) => `#### Task creation guidelines

**Important**: When creating tasks, make sure each task is independently shippable
without failing validation checks (typechecks, linting, tests). If a task would only
pass validations when combined with another, combine the work into one task.

Each task should be an atomic, committable piece of work.
Instead of creating tasks like "Refactor the authentication system", create
smaller tasks like "Implement OAuth2 login endpoint", "Add JWT token refresh mechanism", etc.${
  options?.specsDirectory
    ? `

If you need to add a research task, mention in the description that it needs to:
- add a specification file in the \`${options.specsDirectory}\` directory with
  an implementation plan based on the research findings.
- once the specification file is added, turn the implementation plan into tasks
  in the prd.yml file. Each task should reference the specification file in its
  description, and be small, atomic and independently shippable without failing
  validation checks (typechecks, linting, tests).
- make sure the follow up tasks include a dependency on the research task.`
    : ""
}`
