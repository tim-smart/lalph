import { Effect, Layer, Option, pipe, Schema, ServiceMap } from "effect"
import { Setting, Settings } from "./Settings.ts"
import { LinearIssueSource, resetLinear } from "./Linear.ts"
import { Prompt } from "effect/unstable/cli"
import { GithubIssueSource, resetGithub } from "./Github.ts"
import { IssueSource } from "./IssueSource.ts"
import { PlatformServices } from "./shared/platform.ts"
import { atomRuntime } from "./shared/runtime.ts"
import { Atom, Reactivity } from "effect/unstable/reactivity"
import type { PrdIssue } from "./domain/PrdIssue.ts"

const issueSources: ReadonlyArray<typeof CurrentIssueSource.Service> = [
  {
    id: "linear",
    name: "Linear",
    layer: LinearIssueSource,
    reset: resetLinear,
    githubPrInstructions: `The title of the PR should include the task id.`,
  },
  {
    id: "github",
    name: "GitHub Issues",
    layer: GithubIssueSource,
    reset: resetGithub,
    githubPrInstructions: `At the start of your PR description, include a line that closes the issue: Closes {task id}`,
  },
]

const selectedIssueSource = new Setting(
  "issueSource",
  Schema.Literals(issueSources.map((s) => s.id)),
)

export const selectIssueSource = Effect.gen(function* () {
  const source = yield* Prompt.select({
    message: "Select issue source:",
    choices: issueSources.map((s) => ({
      title: s.name,
      value: s,
    })),
  })
  yield* selectedIssueSource.set(Option.some(source.id))
  yield* source.reset
  return source
})

const getOrSelectIssueSource = Effect.gen(function* () {
  const issueSource = yield* selectedIssueSource.get
  if (Option.isSome(issueSource)) {
    return issueSources.find((s) => s.id === issueSource.value)!
  }
  return yield* selectIssueSource
})

export const resetCurrentIssueSource = Effect.gen(function* () {
  const source = yield* getOrSelectIssueSource
  yield* source.reset
})

export const statusCurrentIssueSource = Effect.gen(function* () {
  const service = yield* IssueSource
  yield* service.status
})

export class CurrentIssueSource extends ServiceMap.Service<
  CurrentIssueSource,
  {
    readonly id: string
    readonly name: string
    readonly layer: Layer.Layer<
      IssueSource,
      Layer.Error<typeof LinearIssueSource | typeof GithubIssueSource>,
      Layer.Services<typeof LinearIssueSource | typeof GithubIssueSource>
    >
    readonly reset: Effect.Effect<void, never, Settings>
    readonly githubPrInstructions: string
  }
>()("lalph/CurrentIssueSource") {
  static layer = Layer.effectServices(
    Effect.gen(function* () {
      const source = yield* getOrSelectIssueSource
      const services = yield* Layer.build(source.layer).pipe(
        Effect.withSpan("CurrentIssueSource.build"),
      )
      return ServiceMap.add(services, CurrentIssueSource, source)
    }),
  ).pipe(Layer.provide([Settings.layer, PlatformServices]))
}

// Atoms

export const issueSourceRuntime = atomRuntime(
  CurrentIssueSource.layer.pipe(Layer.orDie),
)

export const currentIssuesAtom = pipe(
  issueSourceRuntime.atom(
    Effect.fnUntraced(function* (get) {
      const source = yield* IssueSource
      const issues = yield* source.issues.pipe(
        Effect.withSpan("currentIssuesAtom.refresh"),
      )
      const handle = setTimeout(() => {
        get.refreshSelf()
      }, 30_000)
      get.addFinalizer(() => clearTimeout(handle))
      return issues
    }),
  ),
  atomRuntime.withReactivity(["issues"]),
  Atom.keepAlive,
)

// Helpers

const getCurrentIssues = Atom.getResult(currentIssuesAtom, {
  suspendOnWaiting: true,
})

export const checkForWork = Effect.gen(function* () {
  const issues = yield* getCurrentIssues
  const hasIncomplete = issues.some(
    (issue) => issue.state === "todo" && issue.blockedBy.length === 0,
  )
  if (!hasIncomplete) {
    return yield* new NoMoreWork({})
  }
})

export const resetInProgress = Effect.gen(function* () {
  const source = yield* IssueSource
  const reactivity = yield* Reactivity.Reactivity
  const issues = yield* getCurrentIssues
  const inProgress = issues.filter(
    (issue): issue is PrdIssue & { id: string } =>
      issue.state === "in-progress" && issue.id !== null,
  )
  if (inProgress.length === 0) return
  yield* Effect.forEach(
    inProgress,
    (issue) =>
      source.updateIssue({
        issueId: issue.id,
        state: "todo",
      }),
    { concurrency: 5, discard: true },
  ).pipe(reactivity.withBatch)
})

export class NoMoreWork extends Schema.ErrorClass<NoMoreWork>(
  "lalph/Prd/NoMoreWork",
)({
  _tag: Schema.tag("NoMoreWork"),
}) {
  readonly message = "No more work to be done!"
}
