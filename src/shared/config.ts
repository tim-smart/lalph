import { Config } from "effect"

export const configEditor = Config.string("LALPH_EDITOR").pipe(
  Config.orElse(() => Config.string("EDITOR")),
  Config.withDefault(() => "nano"),
)
