import { Option, Schema } from "effect"

export const ProjectId = Schema.String.pipe(Schema.brand("lalph/ProjectId"))
export type ProjectId = typeof ProjectId.Type

export class Project extends Schema.Class<Project>("lalph/Project")({
  id: ProjectId,
  targetBranch: Schema.Option(Schema.String),
  concurrency: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  gitFlow: Schema.Literals(["pr", "commit"]),
  reviewMode: Schema.Boolean,
}) {
  static defaultProject = new Project({
    id: ProjectId.makeUnsafe("default"),
    targetBranch: Option.none(),
    concurrency: 1,
    gitFlow: "pr",
    reviewMode: true,
  })
}
