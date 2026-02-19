import * as S from "effect/Schema"

export class Author extends S.Class<Author>("Author")({
  login: S.String,
}) {}

// Prefixes of bot users that we want to ignore when determining if a comment is
// from a bot or not. This is not an exhaustive list, but covers some common
// cases.
const commonBotUserPrefixes = [
  "dependabot",
  "github",
  "changeset",
  "renovate",
  "snyk",
  "coderabbit",
]

export class Comment extends S.Class<Comment>("Comment")({
  id: S.String,
  body: S.String,
  author: Author,
  createdAt: S.String,
}) {
  get isBot() {
    const login = this.author.login.toLowerCase()
    return commonBotUserPrefixes.some((prefix) => login.startsWith(prefix))
  }
}

export class PullRequestComments extends S.Class<PullRequestComments>(
  "PullRequestComments",
)({
  nodes: S.Array(Comment),
}) {}

export class PullRequest extends S.Class<PullRequest>("PullRequest")({
  url: S.String,
  reviewDecision: S.Null,
  reviews: S.suspend(() => Reviews),
  reviewThreads: S.suspend(() => ReviewThreads),
  comments: PullRequestComments,
}) {}

export class Repository extends S.Class<Repository>("Repository")({
  pullRequest: PullRequest,
}) {}

export class Data extends S.Class<Data>("Data")({
  repository: Repository,
}) {}

export class GithubPullRequestData extends S.Class<GithubPullRequestData>(
  "GithubPullRequestData",
)({
  data: Data,
}) {}

export class Review extends S.Class<Review>("Review")({
  id: S.String,
  author: Author,
  body: S.String,
}) {}

export class Reviews extends S.Class<Reviews>("Reviews")({
  nodes: S.Array(Review),
}) {}

export class ReviewComment extends S.Class<ReviewComment>("ReviewComment")({
  id: S.String,
  author: Author,
  body: S.String,
  path: S.String,
  originalLine: S.Number,
  diffHunk: S.String,
  createdAt: S.String,
}) {}

export class NodeComments extends S.Class<NodeComments>("NodeComments")({
  nodes: S.Array(ReviewComment),
}) {}

export class ReviewThreadsNode extends S.Class<ReviewThreadsNode>(
  "ReviewThreadsNode",
)({
  isCollapsed: S.Boolean,
  isOutdated: S.Boolean,
  isResolved: S.Boolean,
  comments: NodeComments,
}) {
  readonly commentNodes = this.comments.nodes
  readonly shouldDisplayThread = !this.isCollapsed && !this.isOutdated
}

export class ReviewThreads extends S.Class<ReviewThreads>("ReviewThreads")({
  nodes: S.Array(ReviewThreadsNode),
}) {}
