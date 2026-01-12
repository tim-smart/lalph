import { Effect } from "effect"
import { PromptGen } from "./PromptGen.ts"
import { Prd } from "./Prd.ts"

export const run = Effect.gen(function* () {
  yield* Effect.log("Runner started")
  yield* Effect.log("spin up claude or opencode here")
}).pipe(Effect.provide([PromptGen, Prd.layer]))
