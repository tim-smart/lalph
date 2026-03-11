import { Agent, OutputFormatter } from "clanka"
import { Duration, Effect, Layer, Stdio, Stream } from "effect"
import {
  TaskChooseTools,
  TaskTools,
  TaskToolsHandlers,
  TaskToolsWithChoose,
} from "./TaskTools.ts"
import { ClankaModels, clankaSubagent } from "./ClankaModels.ts"
import { withStallTimeout } from "./shared/stream.ts"

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

    const agent = yield* Agent.make({
      ...options,
      tools: (options.withChoose
        ? TaskChooseTools
        : TaskTools) as unknown as typeof TaskToolsWithChoose,
      subagentModel: clankaSubagent(models, options.model),
    }).pipe(Effect.provide(models.get(options.model)))

    yield* muxer.add(agent.output)

    let stream = options.stallTimeout
      ? withStallTimeout(options.stallTimeout)(agent.output)
      : agent.output

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
  Effect.provide([Agent.layerServices, TaskToolsHandlers]),
)
