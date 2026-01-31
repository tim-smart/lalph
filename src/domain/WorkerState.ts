import { Data, DateTime, Exit } from "effect"
import type { ProjectId } from "./Project.ts"

export class WorkerState extends Data.Class<{
  id: number
  projectId: ProjectId
  status: WorkerStatus
  lastTransitionAt: DateTime.Utc
}> {
  static initial(options: {
    readonly projectId: ProjectId
    readonly id: number
  }) {
    return new WorkerState({
      ...options,
      status: WorkerStatus.Booting(),
      lastTransitionAt: DateTime.nowUnsafe(),
    })
  }

  transitionTo(status: WorkerStatus): WorkerState {
    return new WorkerState({
      ...this,
      status,
      lastTransitionAt: DateTime.nowUnsafe(),
    })
  }

  get issueId(): string | undefined {
    if ("issueId" in this.status && this.status.issueId) {
      return this.status.issueId
    }
    return undefined
  }
}

export type WorkerStatus = Data.TaggedEnum<{
  Booting: {}
  ChoosingTask: {}
  Working: { issueId: string }
  Reviewing: { issueId: string }
  Merging: { issueId: string }
  Exited: { issueId?: string | undefined; exit: Exit.Exit<void, unknown> }
}>
export const WorkerStatus = Data.taggedEnum<WorkerStatus>()
