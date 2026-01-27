import * as S from "effect/Schema"

export const Type = S.Literals([
  "completed",
  "started",
  "unstarted",
  "canceled",
  "backlog",
  "triage",
])
export type Type = S.Schema.Type<typeof Type>

export class State extends S.Class<State>("State")({
  id: S.String,
  name: S.String,
  type: Type,
}) {}

export class Issue extends S.Class<Issue>("Issue")({
  id: S.String,
  identifier: S.String,
}) {}

export class InverseRelationsNode extends S.Class<InverseRelationsNode>(
  "InverseRelationsNode",
)({
  type: S.String,
  issue: Issue,
}) {}

export class InverseRelations extends S.Class<InverseRelations>(
  "InverseRelations",
)({
  nodes: S.Array(InverseRelationsNode),
}) {}

export class IssuesNode extends S.Class<IssuesNode>("IssuesNode")({
  id: S.String,
  identifier: S.String,
  title: S.String,
  description: S.String,
  priority: S.Number,
  estimate: S.Number,
  state: State,
  labelIds: S.Array(S.Any),
  inverseRelations: InverseRelations,
}) {}

export class Issues extends S.Class<Issues>("Issues")({
  nodes: S.Array(IssuesNode),
}) {}

export class Data extends S.Class<Data>("Data")({
  issues: Issues,
}) {}

export class LinearIssuesData extends S.Class<LinearIssuesData>(
  "LinearIssuesData",
)({
  data: Data,
}) {}
