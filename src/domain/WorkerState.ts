import { Data } from "effect"

export class WorkerState extends Data.Class<{
  iteration: number
  status: WorkerStatus
}> {}

export type WorkerStatus = Data.TaggedEnum<{
  Booting: {}
  ChoosingTask: {}
  Instructing: { issueId: string }
  Working: { issueId: string }
  Reviewing: { issueId: string }
  Finalizing: { issueId: string }
}>
export const WorkerStatus = Data.taggedEnum<WorkerStatus>()
