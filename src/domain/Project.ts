import { Schema } from "effect"

export const ProjectId = Schema.String.pipe(Schema.brand("lalph/ProjectId"))
export type ProjectId = typeof ProjectId.Type

export class Project extends Schema.Class<Project>("lalph/Project")({
  id: ProjectId,
  enabled: Schema.Boolean,
  targetBranch: Schema.Option(Schema.String),
  concurrency: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  gitFlow: Schema.Literals(["pr", "commit"]),
  reviewAgent: Schema.Boolean,
}) {}
