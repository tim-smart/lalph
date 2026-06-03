import { Effect, Schema } from "effect"
import { CliAgentPresetId } from "./CliAgentPreset.ts"

export const ProjectId = Schema.String.pipe(Schema.brand("lalph/ProjectId"))
export type ProjectId = typeof ProjectId.Type

export class Project extends Schema.Class<Project>("lalph/Project")({
  id: ProjectId,
  enabled: Schema.Boolean,
  targetBranch: Schema.Option(Schema.String),
  concurrency: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  gitFlow: Schema.Literals(["pr", "commit", "ralph"]),
  ralphSpec: Schema.optional(Schema.String),
  ralphPreset: Schema.optional(CliAgentPresetId),
  researchAgent: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
  reviewAgent: Schema.Boolean,
}) {
  update(updates: Partial<Project>): Project {
    return new Project({
      ...this,
      ...updates,
    })
  }
}
