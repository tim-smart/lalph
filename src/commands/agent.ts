import { Effect } from "effect"
import { Command } from "effect/unstable/cli"
import { selectCliAgent } from "../CliAgent.ts"
import { promptForCommandPrefix } from "../CommandPrefix.ts"

export const commandAgent = Command.make("agent").pipe(
  Command.withDescription("Select the CLI agent to use"),
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const agent = yield* selectCliAgent
      yield* promptForCommandPrefix
      return agent
    }),
  ),
)
