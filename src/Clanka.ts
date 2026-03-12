import { Agent, OutputFormatter } from "clanka"
import { Duration, Effect, Layer, pipe, Stdio, Stream } from "effect"
import { TaskChooseTools, TaskTools, TaskToolsHandlers } from "./TaskTools.ts"
import { ClankaModels } from "./ClankaModels.ts"
import { withStallTimeout } from "./shared/stream.ts"
import { NodeHttpClient } from "@effect/platform-node"

export const ClankaMuxerLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const muxer = yield* OutputFormatter.Muxer
    const stdio = yield* Stdio.Stdio
    yield* muxer.output.pipe(Stream.run(stdio.stdout()), Effect.forkScoped)
  }),
).pipe(Layer.provideMerge(OutputFormatter.layerMuxer(OutputFormatter.pretty)))

export const runClanka = Effect.fnUntraced(
  function* (options: {
    readonly directory: string
    readonly model: string
    readonly prompt: string
    readonly system?: string | undefined
    readonly stallTimeout?: Duration.Input | undefined
    readonly steer?: Stream.Stream<string> | undefined
    readonly withChoose?: boolean | undefined
  }) {
    const models = yield* ClankaModels
    const muxer = yield* OutputFormatter.Muxer
    const agent = yield* Agent.Agent

    const output = yield* pipe(
      agent.send({
        prompt: options.prompt,
        system: options.system,
      }),
      Effect.provide(models.get(options.model)),
    )

    yield* muxer.add(output)

    let stream = options.stallTimeout
      ? withStallTimeout(options.stallTimeout)(output)
      : output

    if (options.steer) {
      yield* options.steer.pipe(
        Stream.switchMap(
          Effect.fnUntraced(function* (message) {
            yield* Effect.log(`Received steer message: ${message}`)
            yield* agent.steer(message)
          }, Stream.fromEffectDrain),
        ),
        Stream.runDrain,
        Effect.forkScoped,
      )
    }

    yield* stream.pipe(
      Stream.runDrain,
      Effect.catchTag("AgentFinished", () => Effect.void),
    )
  },
  Effect.scoped,
  (effect, options) =>
    Effect.provide(
      effect,
      Agent.layerLocal({
        directory: options.directory,
        tools: options.withChoose ? TaskChooseTools : TaskTools,
      }),
      { local: true },
    ),
  Effect.provide([NodeHttpClient.layerUndici, TaskToolsHandlers]),
)
