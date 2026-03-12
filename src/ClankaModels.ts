// oxlint-disable typescript/no-explicit-any
import { NodeHttpClient } from "@effect/platform-node"
import { Agent, Codex, Copilot } from "clanka"
import { Effect, flow, Layer, LayerMap, Schema } from "effect"
import { layerKvs } from "./Kvs.ts"

export const ModelServices = NodeHttpClient.layerUndici.pipe(
  Layer.merge(layerKvs),
)

const Reasoning = Schema.Literals(["low", "medium", "high", "xhigh"])
const parseInput = flow(
  Schema.decodeUnknownEffect(
    Schema.Tuple([
      Schema.Literals(["openai", "copilot"]),
      Schema.String,
      Reasoning,
    ]),
  ),
  Effect.orDie,
)

export class ClankaModels extends LayerMap.Service<ClankaModels>()(
  "lalph/ClankaModels",
  {
    dependencies: [ModelServices],
    lookup: Effect.fnUntraced(function* (input: string) {
      const [provider, model, reasoning] = yield* parseInput(input.split("/"))
      const layer = resolve(provider, model, reasoning)
      if (reasoning === "low" || reasoning === "medium") {
        return layer
      }
      return Layer.merge(
        layer,
        Agent.layerSubagentModel(resolve(provider, model, "medium")),
      )
    }, Layer.unwrap),
  },
) {}

const resolve = (
  provider: "openai" | "copilot",
  model: string,
  reasoning: typeof Reasoning.Type,
) => {
  switch (provider) {
    case "openai": {
      return Codex.model(model, {
        reasoning: {
          effort: reasoning,
        },
      })
    }
    case "copilot": {
      return Copilot.model(model, {
        ...reasoningToCopilotConfig(model, reasoning),
      })
    }
  }
}

const reasoningToCopilotConfig = (
  model: string,
  reasoning: typeof Reasoning.Type,
) => {
  if (model.startsWith("claude")) {
    switch (reasoning) {
      case "low":
        return {}
      case "medium":
        return { reasoningEffort: 4000 }
      case "high":
        return { thinking_budget: 16000 }
      case "xhigh":
        return { thinking_budget: 31999 }
    }
  }
  return { reasoningEffort: reasoning }
}
