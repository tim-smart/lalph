import { Data, Exit } from "effect"

export class WorkerState extends Data.Class<{
  iteration: number
  status: WorkerStatus
}> {
  static initial(iteration: number) {
    return new WorkerState({
      iteration,
      status: WorkerStatus.Booting(),
    })
  }

  transitionTo(status: WorkerStatus): WorkerState {
    return new WorkerState({
      iteration: this.iteration,
      status,
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
  Instructing: { issueId: string }
  Working: { issueId: string }
  Reviewing: { issueId: string }
  Merging: { issueId: string }
  Exited: { issueId?: string | undefined; exit: Exit.Exit<void, unknown> }
}>
export const WorkerStatus = Data.taggedEnum<WorkerStatus>()
