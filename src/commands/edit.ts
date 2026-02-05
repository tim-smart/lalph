import { Command } from "effect/unstable/cli"
import { Effect, Layer } from "effect"
import { Prd } from "../Prd.ts"
import { layerProjectIdPrompt } from "../Projects.ts"
import { Editor } from "../Editor.ts"

const handler = Command.withHandler(
  Effect.fnUntraced(
    function* () {
      const prd = yield* Prd
      const editor = yield* Editor
      yield* editor.edit(prd.path)
    },
    Effect.provide([
      Prd.layerLocalProvided.pipe(Layer.provideMerge(layerProjectIdPrompt)),
      Editor.layer,
    ]),
  ),
)

export const commandEdit = Command.make("edit").pipe(
  Command.withDescription(
    "Open the selected project's .lalph/prd.yml in your editor.",
  ),
  handler,
)

export const commandEditAlias = Command.make("e").pipe(
  Command.withDescription(
    "Alias for 'edit' (open the selected project's .lalph/prd.yml in your editor).",
  ),
  handler,
)
