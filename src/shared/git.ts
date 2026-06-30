export const parseBranch = (
  ref: string,
): {
  readonly remote: string
  readonly branch: string
  readonly branchWithRemote: string
} => {
  if (!ref.startsWith("origin/") && !ref.startsWith("upstream/")) {
    return { remote: "origin", branch: ref, branchWithRemote: `origin/${ref}` }
  }
  const separator = ref.indexOf("/")
  const remote = ref.slice(0, separator)
  const branch = ref.slice(separator + 1)
  const branchWithRemote = `${remote}/${branch}`
  return { remote, branch, branchWithRemote } as const
}
