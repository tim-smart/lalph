import { Layer } from "effect"
import { Atom } from "effect/unstable/reactivity"

export const lalphMemoMap = Layer.makeMemoMapUnsafe()

export const makeAtomRuntime = Atom.context({ memoMap: lalphMemoMap })
