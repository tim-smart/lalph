import { Layer } from "effect"
import { Atom } from "effect/unstable/reactivity"
import { TracingLayer } from "../Tracing.ts"

export const lalphMemoMap = Layer.makeMemoMapUnsafe()

export const atomRuntime = Atom.context({ memoMap: lalphMemoMap })

atomRuntime.addGlobalLayer(TracingLayer)
