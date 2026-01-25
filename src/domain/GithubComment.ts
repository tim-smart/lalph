import * as S from "effect/Schema"

export class Author extends S.Class<Author>("github/Author")({
  login: S.String,
}) {}

export class Comment extends S.Class<Comment>("github/Comment")({
  id: S.String,
  body: S.String,
  author: Author,
  // createdAt: S.String,
}) {}

export class CommentsEdge extends S.Class<CommentsEdge>("github/CommentsEdge")({
  node: Comment,
}) {}

export class PullRequestComments extends S.Class<PullRequestComments>(
  "PullRequestComments",
)({
  edges: S.Array(CommentsEdge),
}) {}

export class PullRequest extends S.Class<PullRequest>("github/PullRequest")({
  url: S.String,
  reviewThreads: S.suspend(() => ReviewThreads),
  comments: PullRequestComments,
}) {}

export class Repository extends S.Class<Repository>("github/Repository")({
  pullRequest: PullRequest,
}) {}

export class Data extends S.Class<Data>("github/Data")({
  repository: Repository,
}) {}

export class CommentsData extends S.Class<CommentsData>("github/CommentsData")({
  data: Data,
}) {}

export class ReviewComment extends S.Class<ReviewComment>(
  "github/ReviewComment",
)({
  id: S.String,
  author: Author,
  body: S.String,
  path: S.String,
  originalLine: S.NullOr(S.Number),
  diffHunk: S.String,
  // createdAt: S.String,
}) {}

export class NodeComments extends S.Class<NodeComments>("github/NodeComments")({
  nodes: S.Array(ReviewComment),
}) {}

export class ReviewThreadNode extends S.Class<ReviewThreadNode>(
  "github/ReviewThreadNode",
)({
  isCollapsed: S.Boolean,
  isOutdated: S.Boolean,
  isResolved: S.Boolean,
  comments: NodeComments,
}) {
  readonly commentNodes = this.comments.nodes
  readonly shouldDisplayThread = !this.isCollapsed && !this.isOutdated
}

export class ReviewThreadsEdge extends S.Class<ReviewThreadsEdge>(
  "ReviewThreadsEdge",
)({
  node: ReviewThreadNode,
}) {}

export class ReviewThreads extends S.Class<ReviewThreads>(
  "github/ReviewThreads",
)({
  edges: S.Array(ReviewThreadsEdge),
}) {}
