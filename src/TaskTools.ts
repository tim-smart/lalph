import { Deferred, Effect, Schema, ServiceMap, Struct } from "effect"
import { Tool, Toolkit } from "effect/unstable/ai"
import { PrdIssue } from "./domain/PrdIssue.ts"
import { IssueSource } from "./IssueSource.ts"
import { CurrentProjectId } from "./Settings.ts"

export class ChosenTaskDeferred extends ServiceMap.Reference(
  "lalph/TaskTools/ChosenTaskDeferred",
  {
    defaultValue: Deferred.makeUnsafe<{
      readonly taskId: string
      readonly githubPrNumber?: number | undefined
    }>,
  },
) {}

export class TaskTools extends Toolkit.make(
  Tool.make("listTasks", {
    description: "Returns the current list of tasks.",
    success: Schema.Array(
      Schema.Struct({
        id: Schema.String.annotate({
          documentation: "The unique identifier of the task.",
        }),
        ...Struct.pick(PrdIssue.fields, [
          "title",
          "description",
          "state",
          "priority",
          "estimate",
          "blockedBy",
        ]),
      }),
    ),
    dependencies: [CurrentProjectId],
  }),
  Tool.make("chooseTask", {
    description: "Choose the task to work on",
    parameters: Schema.Struct({
      taskId: Schema.String,
      githubPrNumber: Schema.optional(Schema.Number),
    }),
  }),
  Tool.make("createTask", {
    description: "Create a new task and return it's id.",
    parameters: Schema.Struct({
      title: Schema.String,
      description: PrdIssue.fields.description,
      state: PrdIssue.fields.state,
      priority: PrdIssue.fields.priority,
      estimate: PrdIssue.fields.estimate,
      blockedBy: PrdIssue.fields.blockedBy,
    }),
    success: Schema.String,
    dependencies: [CurrentProjectId],
  }),
  Tool.make("updateTask", {
    description: "Update a task. Supports partial updates",
    parameters: Schema.Struct({
      taskId: Schema.String,
      title: Schema.optional(PrdIssue.fields.title),
      description: Schema.optional(PrdIssue.fields.description),
      state: Schema.optional(PrdIssue.fields.state),
      blockedBy: Schema.optional(PrdIssue.fields.blockedBy),
    }),
    dependencies: [CurrentProjectId],
  }),
  Tool.make("removeTask", {
    description: "Remove a task by it's id.",
    parameters: Schema.String.annotate({
      identifier: "taskId",
    }),
    dependencies: [CurrentProjectId],
  }),
) {}

export const TaskToolsHandlers = TaskTools.toLayer(
  Effect.gen(function* () {
    const source = yield* IssueSource

    return TaskTools.of({
      listTasks: Effect.fn("TaskTools.listTasks")(function* () {
        yield* Effect.log(`Calling "listTasks"`)
        const projectId = yield* CurrentProjectId
        const tasks = yield* source.issues(projectId)
        return tasks.map((issue) => ({
          id: issue.id ?? "",
          title: issue.title,
          description: issue.description,
          state: issue.state,
          priority: issue.priority,
          estimate: issue.estimate,
          blockedBy: issue.blockedBy,
        }))
      }, Effect.orDie),
      chooseTask: Effect.fn("TaskTools.chooseTask")(function* (options) {
        yield* Effect.log(`Calling "chooseTask"`).pipe(
          Effect.annotateLogs(options),
        )
        const deferred = yield* ChosenTaskDeferred
        yield* Deferred.succeed(deferred, options)
      }),
      createTask: Effect.fn("TaskTools.createTask")(function* (options) {
        yield* Effect.log(`Calling "createTask"`)
        const projectId = yield* CurrentProjectId
        const taskId = yield* source.createIssue(
          projectId,
          new PrdIssue({
            ...options,
            id: null,
            autoMerge: false,
          }),
        )
        return taskId.id
      }, Effect.orDie),
      updateTask: Effect.fn("TaskTools.updateTask")(function* (options) {
        yield* Effect.log(`Calling "updateTask"`).pipe(
          Effect.annotateLogs({ taskId: options.taskId }),
        )
        const projectId = yield* CurrentProjectId
        yield* source.updateIssue({
          projectId,
          issueId: options.taskId,
          ...options,
        })
      }, Effect.orDie),
      removeTask: Effect.fn("TaskTools.removeTask")(function* (taskId) {
        yield* Effect.log(`Calling "removeTask"`).pipe(
          Effect.annotateLogs({ taskId }),
        )
        const projectId = yield* CurrentProjectId
        yield* source.cancelIssue(projectId, taskId)
      }, Effect.orDie),
    })
  }),
)
