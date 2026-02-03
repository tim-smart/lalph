import { Schema } from "effect"
import { CliAgentFromId } from "./CliAgent.ts"

export class CliAgentPreset extends Schema.Class<CliAgentPreset>(
  "lalph/CliAgentPreset",
)({
  id: Schema.NonEmptyString,
  cliAgent: CliAgentFromId,
  extraArgs: Schema.Array(Schema.String),
}) {}
