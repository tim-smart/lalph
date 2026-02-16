# Information

- The base branch for this repository is `master`.
- The package manager used is `pnpm`.

# Changesets

Every pull request should include a changeset describing the changes made.
Changesets are added to the `.changeset/` directory.

There should one be ONE changeset per pull request.

# Specifications

To learn more about previous and current specifications for this project, see
the `.specs/README.md` file.

# Learning more about the "effect" library

The full source code for the `effect` library is in `.repos/effect/`.

Use this for learning more about the library, rather than browsing the code in
`node_modules/`.

## Prefer `Effect.fnUntraced` over functions that return `Effect.gen`

Instead of writing:

```ts
const fn = (param: string) =>
  Effect.gen(function* () {
    // ...
  })
```

Prefer:

```ts
const fn = Effect.fnUntraced(function* (param: string) {
  // ...
})
```
