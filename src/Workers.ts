import {
  Chunk,
  Effect,
  Exit,
  FiberMap,
  HashMap,
  pipe,
  ServiceMap,
  Stream,
} from "effect"
import { Atom, AtomRegistry } from "effect/unstable/reactivity"
import { WorkerState, WorkerStatus } from "./domain/WorkerState.ts"
import type { ProjectId } from "./domain/Project.ts"

export const activeWorkersAtom = Atom.make(
  HashMap.empty<number, Atom.Writable<WorkerState>>(),
)

export const workerOutputAtom = Atom.family((_id: number) =>
  Atom.make(Chunk.empty<string>()),
)

export const activeWorkerLoggingAtom = Atom.make(
  Effect.fnUntraced(function* (get) {
    const fibers = yield* FiberMap.make<number>()

    yield* get.stream(activeWorkersAtom).pipe(
      Stream.runForEach(
        Effect.fnUntraced(function* (workers) {
          const toRemove = new Map(fibers)
          for (const [id, state] of workers) {
            toRemove.delete(id)
            yield* FiberMap.run(
              fibers,
              id,
              pipe(
                get.stream(state),
                Stream.runForEach((state) =>
                  Effect.logInfo("Worker state change", state.status).pipe(
                    Effect.annotateLogs({
                      workerId: state.id,
                      projectId: state.projectId,
                    }),
                  ),
                ),
              ),
              { onlyIfMissing: true },
            )
          }
          for (const [id] of toRemove) {
            yield* FiberMap.remove(fibers, id)
          }
        }),
      ),
      Effect.forkScoped,
    )
  }),
)

export class CurrentWorkerState extends ServiceMap.Service<
  CurrentWorkerState,
  {
    readonly state: Atom.Writable<WorkerState>
    readonly output: Atom.Writable<Chunk.Chunk<string>>
  }
>()("lalph/CurrentWorkerState") {}

export const constWorkerMaxOutputChunks = 1000

let workerIdCounter = 0
export const withWorkerState =
  (projectId: ProjectId) =>
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<
    A,
    E,
    AtomRegistry.AtomRegistry | Exclude<R, CurrentWorkerState>
  > =>
    AtomRegistry.AtomRegistry.use((registry) => {
      const workerId = workerIdCounter++
      const state = Atom.make(
        WorkerState.initial({
          id: workerId,
          projectId,
        }),
      )
      const output = workerOutputAtom(workerId)
      const unmountState = registry.mount(state)
      const unmountOutput = registry.mount(output)
      registry.update(activeWorkersAtom, HashMap.set(workerId, state))
      return effect.pipe(
        Effect.onExit((exit) => {
          registry.update(state, (state) =>
            state.transitionTo(
              WorkerStatus.Exited({
                issueId:
                  "issueId" in state.status ? state.status.issueId : undefined,
                exit: Exit.asVoid(exit),
              }),
            ),
          )
          unmountState()
          unmountOutput()
          registry.update(activeWorkersAtom, HashMap.remove(workerId))
        }),
        Effect.provideService(CurrentWorkerState, { state, output }),
      )
    })
