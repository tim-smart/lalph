import { Command } from "effect/unstable/cli"
import { Effect, Layer, Stream } from "effect"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Linear } from "./Linear.ts"

const root = Command.make("lalph").pipe(
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const linear = yield* Linear
      const projects = yield* Stream.runCollect(linear.projects)

      console.log("Projects:", projects)
    }),
  ),
)

Command.run(root, {
  version: "0.1.0",
}).pipe(
  Effect.provide(Linear.layer.pipe(Layer.provideMerge(NodeServices.layer))),
  NodeRuntime.runMain,
)
