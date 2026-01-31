import { ServiceMap } from "effect"
import type { ProjectId } from "./domain/Project.ts"

export class CurrentProjectId extends ServiceMap.Service<
  CurrentProjectId,
  ProjectId
>()("lalph/CurrentProjectId") {}
