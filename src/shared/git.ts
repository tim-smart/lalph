export const parseBranch = (
  ref: string,
): {
  readonly remote: string
  readonly branch: string
  readonly branchWithRemote: string
} => {
  const parts = ref.split("/")
  const remote = parts.length > 1 ? parts[0]! : "origin"
  const branch = parts.length > 1 ? parts.slice(1).join("/") : parts[0]!
  const branchWithRemote = `${remote}/${branch}`
  return { remote, branch, branchWithRemote } as const
}
