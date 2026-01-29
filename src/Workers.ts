import {
  Chunk,
  Effect,
  Exit,
  FiberMap,
  HashSet,
  pipe,
  ServiceMap,
  Stream,
} from "effect"
import { Atom, AtomRegistry } from "effect/unstable/reactivity"
import { WorkerState, WorkerStatus } from "./domain/WorkerState.ts"

export const activeWorkersAtom = Atom.make(HashSet.empty<number>())

export const workerStateAtom = Atom.family((id: number) =>
  Atom.make(WorkerState.initial(id)),
)

export const workerOutputAtom = Atom.family((_id: number) =>
  Atom.make(Chunk.empty<string>()),
)

export const activeWorkerLoggingAtom = Atom.make(
  Effect.fnUntraced(function* (get) {
    const fibers = yield* FiberMap.make<number>()

    yield* get.stream(activeWorkersAtom).pipe(
      Stream.runForEach(
        Effect.fnUntraced(function* (ids) {
          const toRemove = new Map(fibers)
          for (const id of ids) {
            toRemove.delete(id)
            const state = workerStateAtom(id)
            yield* FiberMap.run(
              fibers,
              id,
              pipe(
                get.stream(state),
                Stream.runForEach((state) =>
                  Effect.logInfo("Worker state change", state.status).pipe(
                    Effect.annotateLogs({ workerId: id }),
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

export const withWorkerState = (iteration: number) => {
  const state = workerStateAtom(iteration)
  const output = workerOutputAtom(iteration)
  return <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<
    A,
    E,
    AtomRegistry.AtomRegistry | Exclude<R, CurrentWorkerState>
  > =>
    AtomRegistry.AtomRegistry.use((registry) => {
      const unmountState = registry.mount(state)
      const unmountOutput = registry.mount(output)
      registry.update(activeWorkersAtom, HashSet.add(iteration))
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
          registry.update(activeWorkersAtom, HashSet.remove(iteration))
        }),
        Effect.provideService(CurrentWorkerState, { state, output }),
      )
    })
}
