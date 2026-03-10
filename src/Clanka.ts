import { Agent, OutputFormatter } from "clanka"
import { Duration, Effect, Stream } from "effect"
import { TaskTools, TaskToolsHandlers } from "./TaskTools.ts"
import { clankaSubagent } from "./ClankaModels.ts"
import { withStallTimeout } from "./shared/stream.ts"
import type { AiError } from "effect/unstable/ai"
import type { RunnerStalled } from "./domain/Errors.ts"

export const runClanka = Effect.fnUntraced(
  /** The working directory to run the agent in */
  function* (options: {
    readonly directory: string
    readonly prompt: string
    readonly system?: string | undefined
    readonly stallTimeout?: Duration.Input | undefined
  }) {
    const agent = yield* Agent.make({
      ...options,
      tools: TaskTools,
      subagentModel: clankaSubagent,
    })
    let stream = options.stallTimeout
      ? withStallTimeout(options.stallTimeout)(agent.output)
      : agent.output

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
