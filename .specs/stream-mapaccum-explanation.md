# Explain what `Stream.mapAccum` does

## Context

Task: `TIM-717`

This repository uses Effect streams in several places, and contributors may need
a quick explanation of the `Stream.mapAccum` combinator when reading or writing
stream transformations.

There is no existing repository-local documentation for this combinator, so this
spec records a concise explanation that future work can reference.

## Explanation

`Stream.mapAccum` is a stateful stream transformation.

It takes:

- an initial state
- a function `(state, value) => [nextState, outputValues]`

For each input element, it:

1. receives the current state and the current stream element
2. returns the next state
3. emits zero or more output elements

So it is like combining:

- **mapping**, because each input can produce output values
- **folding / accumulation**, because state is carried forward from one element
  to the next
- **flat-mapping to arrays**, because each input can emit many outputs, not just
  one

In Effect's implementation, the callback returns a tuple:

- the updated state
- a `ReadonlyArray` of values to emit for that input

That means `Stream.mapAccum` can be used to:

- keep running totals
- track previous values while transforming the stream
- batch or flush values conditionally
- drop some inputs by returning an empty output array
- emit multiple derived values from a single input

## Mental model

A simple mental model is:

```ts
let state = initial()

for (const value of input) {
  const [nextState, outputs] = f(state, value)
  state = nextState
  emit(...outputs)
}
```

## Example

```ts
import { Effect, Stream } from "effect"

const program = Stream.make(1, 2, 3).pipe(
  Stream.mapAccum(
    () => 0,
    (sum, n) => {
      const next = sum + n
      return [next, [next]] as const
    },
  ),
  Stream.runCollect,
)

// result: [1, 3, 6]
```

Here:

- the state is the running sum
- each input number updates the sum
- the updated sum is emitted

## Related combinators

- `Stream.map`: transforms each element independently, with no carried state
- `Stream.scan`: carries state forward and emits the evolving state each time
- `Stream.mapAccumEffect`: like `mapAccum`, but the step function is
  effectful

## Notes for future work

Authoritative upstream API docs live in:

- `.repos/effect/packages/effect/src/Stream.ts`
- `.repos/effect/LLMS.md`

If a future task needs to improve the actual Effect API documentation for this
operator, the upstream vendored source is the best reference point.
