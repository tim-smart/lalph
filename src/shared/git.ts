export const parseBranch = (
  ref: string,
): {
  readonly remote: string
  readonly branch: string
  readonly branchWithRemote: string
} => {
  if (!ref.startsWith("origin/") && !ref.startsWith("upstream/")) {
    return { remote: "origin", branch: ref, branchWithRemote: ref }
  }
  const [remote, branch] = ref.split("/", 2) as [string, string]
  const branchWithRemote = `${remote}/${branch}`
  return { remote, branch, branchWithRemote } as const
}
