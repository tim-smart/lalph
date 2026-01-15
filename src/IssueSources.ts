import { Effect, Layer, Option, Schema, Unify } from "effect"
import { Setting } from "./Settings.ts"
import { LinearIssueSource, resetLinear } from "./Linear.ts"
import { Prompt } from "effect/unstable/cli"
import { GithubIssueSource } from "./Github.ts"
import { unify } from "effect/Unify"
import type { IssueSource } from "./IssueSource.ts"

const issueSources = [
  {
    id: "linear",
    name: "Linear",
    layer: LinearIssueSource,
    reset: resetLinear,
  },
  {
    id: "github",
    name: "GitHub Issues",
    layer: GithubIssueSource,
    reset: Effect.void,
  },
] as const

type IssueLayer = Layer.Layer<
  IssueSource,
  Layer.Error<(typeof issueSources)[number]["layer"]>,
  Layer.Services<(typeof issueSources)[number]["layer"]>
>

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

export const CurrentIssueSource = Layer.unwrap(
  Effect.gen(function* () {
    const source = yield* getOrSelectIssueSource
    return source.layer as IssueLayer
  }),
)
