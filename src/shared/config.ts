import { Config } from "effect"
import { parseCommand } from "./child-process.ts"

export const configEditor = Config.String("LALPH_EDITOR").pipe(
  Config.orElse(() => Config.String("EDITOR")),
  Config.map(parseCommand),
  Config.withDefault(["nano"]),
)
