# Information

- The base branch for this repository is `master`.
- The package manager used is `pnpm`. Run `pnpm install` to install
  dependencies if `node_modules` is missing.

# Development workflow

- Every commit should pass type checking (`tsc --noEmit`)
- Every commit should be formatted correctly (`prettier --check`)
- Every PR should include a changeset when it affects published packages.

# Library reference

- For learning more about the `effect` library, see the source code in
  `.agents/effect/`.
