import { Agent, OutputFormatter } from "clanka"
import { Duration, Effect, Stream } from "effect"
import {
  TaskTools,
  TaskToolsHandlers,
  TaskToolsWithChoose,
} from "./TaskTools.ts"
import { ClankaModels, clankaSubagent } from "./ClankaModels.ts"
import { withStallTimeout } from "./shared/stream.ts"
import type { AiError } from "effect/unstable/ai"
import type { RunnerStalled } from "./domain/Errors.ts"

export const runClanka = Effect.fnUntraced(
  /** The working directory to run the agent in */
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
    const agent = yield* Agent.make({
      ...options,
      tools: options.withChoose
        ? TaskToolsWithChoose
        : (TaskTools as unknown as typeof TaskToolsWithChoose),
      subagentModel: clankaSubagent(models, options.model),
    }).pipe(Effect.provide(models.get(options.model)))

    let stream = options.stallTimeout
      ? withStallTimeout(options.stallTimeout)(agent.output)
      : agent.output

    if (options.steer) {
      yield* options.steer.pipe(
        Stream.runForEach((message) => agent.steer(message)),
        Effect.forkScoped,
      )
    }

    return yield* stream.pipe(
      OutputFormatter.pretty,
      Stream.runForEachArray((out) => {
        for (const item of out) {
          process.stdout.write(item)
        }
        return Effect.void
      }),
      (_) => _ as Effect.Effect<void, AiError.AiError | RunnerStalled>,
    )
  },
  Effect.scoped,
  Effect.provide([Agent.layerServices, TaskToolsHandlers]),
)
