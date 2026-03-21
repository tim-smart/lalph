import * as Agent from "clanka/Agent"
import * as OutputFormatter from "clanka/OutputFormatter"
import {
  Cause,
  Config,
  Duration,
  Effect,
  identity,
  Layer,
  Option,
  Path,
  Stdio,
  Stream,
} from "effect"
import { Prompt as CliPrompt } from "effect/unstable/cli"
import { TaskChooseTools, TaskTools, TaskToolsHandlers } from "./TaskTools.ts"
import { layerClankaModel, ModelServices } from "./ClankaModels.ts"
import { withStallTimeout } from "./shared/stream.ts"
import { NodeHttpClient } from "@effect/platform-node"
import type { Prompt } from "effect/unstable/ai"
import { OpenAiClient, OpenAiEmbeddingModel } from "@effect/ai-openai"
import { Worktree } from "./Worktree.ts"
import { SemanticSearch } from "clanka"

export const ClankaMuxerLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const muxer = yield* OutputFormatter.Muxer
    const stdio = yield* Stdio.Stdio
    yield* muxer.output.pipe(Stream.run(stdio.stdout()), Effect.forkScoped)
  }),
).pipe(Layer.provideMerge(OutputFormatter.layerMuxer(OutputFormatter.pretty())))

export const SemanticSearchLayer = Layer.unwrap(
  Effect.gen(function* () {
    const worktree = yield* Worktree
    const pathService = yield* Path.Path
    const apiKey = yield* Config.redacted("LALPH_OPENAI_API_KEY").pipe(
      Config.option,
    )
    if (Option.isNone(apiKey)) {
      return Layer.empty
    }
    return SemanticSearch.layer({
      directory: worktree.directory,
      database: pathService.join(
        worktree.directory,
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
        }).pipe(Layer.provide(NodeHttpClient.layerUndici)),
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
    readonly maxContext?: number | undefined
    readonly steer?: Stream.Stream<string> | undefined
    readonly mode?: "ralph" | "choose" | "default" | undefined
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
      options.maxContext
        ? Stream.tap((part) => {
            if (part._tag !== "Usage") return Effect.void
            const contextTokens = part.contextTokens
            if (contextTokens <= options.maxContext!) return Effect.void
            return Effect.fail(new Cause.TimeoutError("Max context reached"))
          })
        : identity,
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
        tools:
          options.mode === "ralph"
            ? undefined
            : options.mode === "choose"
              ? TaskChooseTools
              : TaskTools,
      }).pipe(Layer.merge(layerClankaModel(options.model))),
      { local: true },
    ),
  Effect.provide([ModelServices, TaskToolsHandlers]),
)

export const runClankaPlan = Effect.fnUntraced(
  function* (options: {
    readonly directory: string
    readonly model: string
    readonly prompt: Prompt.RawInput
  }) {
    const stdio = yield* Stdio.Stdio
    const agent = yield* Agent.Agent
    let nextPrompt = options.prompt

    while (true) {
      const output = yield* agent.send({
        prompt: nextPrompt,
        system: `ONLY call taskComplete by itself. NEVER call taskComplete alongside other functions, to ensure you first read output before deciding a task is done.`,
      })

      yield* output.pipe(
        OutputFormatter.pretty({
          outputTruncation: 20,
        }),
        Stream.run(stdio.stdout()),
      )

      console.log("")
      nextPrompt = yield* CliPrompt.text({
        message: ">",
      })
    }
  },
  Effect.scoped,
  (effect, options) =>
    Effect.provide(
      effect,
      Agent.layerLocal({
        directory: options.directory,
      }).pipe(
        Layer.provide(SemanticSearchLayer),
        Layer.merge(layerClankaModel(options.model)),
      ),
      { local: true },
    ),
  Effect.provide([
    ModelServices,
    TaskToolsHandlers,
    Agent.ConversationMode.layer(true),
  ]),
  Effect.ignore(),
)
