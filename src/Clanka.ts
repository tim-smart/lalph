import { Agent, OutputFormatter, SemanticSearch } from "clanka"
import {
  Config,
  Duration,
  Effect,
  Layer,
  Option,
  Path,
  Stdio,
  Stream,
} from "effect"
import { TaskChooseTools, TaskTools, TaskToolsHandlers } from "./TaskTools.ts"
import { ClankaModels } from "./ClankaModels.ts"
import { withStallTimeout } from "./shared/stream.ts"
import { NodeHttpClient } from "@effect/platform-node"
import type { Prompt } from "effect/unstable/ai"
import { OpenAiClient, OpenAiEmbeddingModel } from "@effect/ai-openai"

export const ClankaMuxerLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const muxer = yield* OutputFormatter.Muxer
    const stdio = yield* Stdio.Stdio
    yield* muxer.output.pipe(Stream.run(stdio.stdout()), Effect.forkScoped)
  }),
).pipe(Layer.provideMerge(OutputFormatter.layerMuxer(OutputFormatter.pretty)))

const Search = (directory: string) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const pathService = yield* Path.Path
      const apiKey = yield* Config.redacted("LALPH_OPENAI_API_KEY").pipe(
        Config.option,
      )
      if (Option.isNone(apiKey)) {
        return Layer.empty
      }
      return SemanticSearch.layer({
        directory,
        database: pathService.join(
          directory,
          ".lalph",
          "shared",
          "search.sqlite",
        ),
      }).pipe(
        Layer.orDie,
        Layer.provide(
          OpenAiEmbeddingModel.model("text-embedding-3-small", {
            dimensions: 1536,
          }),
        ),
        Layer.provide(
          OpenAiClient.layer({
            apiKey: apiKey.value,
          }),
        ),
        Layer.tapCause((cause) =>
          Effect.logWarning(`Failed to create SemanticSearch layer`, cause),
        ),
        Layer.catchCause(() => Layer.empty),
      )
    }).pipe(Effect.orDie),
  )

export const runClanka = Effect.fnUntraced(
  function* (options: {
    readonly directory: string
    readonly model: string
    readonly prompt: Prompt.RawInput
    readonly system?: string | undefined
    readonly stallTimeout?: Duration.Input | undefined
    readonly steer?: Stream.Stream<string> | undefined
    readonly withChoose?: boolean | undefined
  }) {
    const muxer = yield* OutputFormatter.Muxer
    const agent = yield* Agent.Agent

    const output = yield* agent.send({
      prompt: options.prompt,
      system: options.system,
    })

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

    return yield* stream.pipe(
      Stream.runDrain,
      Effect.as(""),
      Effect.catchTag("AgentFinished", (e) => Effect.succeed(e.summary)),
    )
  },
  Effect.scoped,
  (effect, options) =>
    Effect.provide(
      effect,
      Agent.layerLocal({
        directory: options.directory,
        tools: options.withChoose ? TaskChooseTools : TaskTools,
      }).pipe(
        Layer.provide(Search(options.directory)),
        Layer.merge(ClankaModels.get(options.model)),
      ),
    ),
  Effect.provide([NodeHttpClient.layerUndici, TaskToolsHandlers]),
)
