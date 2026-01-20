import { Effect, Layer, Option, Schema, ServiceMap } from "effect"
import { Setting, Settings } from "./Settings.ts"
import { LinearIssueSource, resetLinear } from "./Linear.ts"
import { Prompt } from "effect/unstable/cli"
import { GithubIssueSource, resetGithub } from "./Github.ts"
import type { IssueSource } from "./IssueSource.ts"

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
    githubPrInstructions: `At the start of your PR description, include a line that closes the issue, like: Closes {task id}.`,
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
      const services = yield* Layer.buildWithMemoMap(
        source.layer,
        yield* Layer.CurrentMemoMap,
        yield* Effect.scope,
      )
      return ServiceMap.add(services, CurrentIssueSource, source)
    }),
  )
}
