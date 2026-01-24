import { Effect, Layer, Option, Schema, ServiceMap, String } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import {
  CommentsData,
  ReviewComment,
  Comment,
} from "../domain/GithubComment.ts"

export class GithubCli extends ServiceMap.Service<GithubCli>()(
  "lalph/Github/Cli",
  {
    make: Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

      const nameWithOwner =
        yield* ChildProcess.make`gh repo view --json nameWithOwner -q ${".nameWithOwner"}`.pipe(
          ChildProcess.string,
          Effect.option,
          Effect.flatMap((o) =>
            o.pipe(
              Option.map(String.trim),
              Option.filter(String.isNonEmpty),
              Effect.fromOption,
            ),
          ),
        )
      const [owner, repo] = nameWithOwner.split("/") as [string, string]

      const reviewComments = (pr: number) =>
        ChildProcess.make`gh api graphql -f owner=${owner} -f repo=${repo} -F pr=${pr} -f query=${githubReviewCommentsQuery}`.pipe(
          ChildProcess.string,
          Effect.flatMap(Schema.decodeEffect(CommentsFromJson)),
          Effect.map((data) => {
            const comments =
              data.data.repository.pullRequest.comments.edges.map(
                (edge) => edge.node,
              )
            const reviewThreads =
              data.data.repository.pullRequest.reviewThreads.edges.map(
                (edge) => edge.node,
              )
            return { comments, reviewThreads } as const
          }),
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            spawner,
          ),
        )

      const prFeedbackMd = (pr: number) =>
        reviewComments(pr).pipe(
          Effect.map(({ comments, reviewThreads }) => {
            if (comments.length === 0 && reviewThreads.length === 0) {
              return `No review comments found.`
            }

            let content = `# PR feedback

Comments are rendered in XML format.`

            if (reviewThreads.length > 0) {
              const reviewCommentsMd = reviewThreads
                .filter((_) => !_.isCollapsed)
                .map((thread) =>
                  renderReviewComments(
                    thread.commentNodes[0]!,
                    thread.commentNodes.slice(1),
                  ),
                )
                .join("\n\n")
              content += `

## Review Comments

${reviewCommentsMd}`
            }

            if (comments.length > 0) {
              const generalCommentsXml = comments
                .map((comment) => renderGeneralComment(comment))
                .join("\n")
              content += `

## General Comments

<comments>
${generalCommentsXml}
</comments>`
            }

            return content
          }),
        )

      return { owner, repo, reviewComments, prFeedbackMd } as const
    }),
  },
) {
  static layer = Layer.effect(this, this.make)
}

// markdown helper functions

const renderReviewComments = (
  comment: ReviewComment,
  followup: Array<ReviewComment>,
) => `<comment author="${comment.author.login}" path="${comment.path}"${
  comment.originalLine ? ` originalLine="${comment.originalLine}"` : ""
}>
  <diffHunk><![CDATA[${comment.diffHunk}]]></diffHunk>
  <body><![CDATA[${comment.body}]]></body>${
    followup.length > 0
      ? `

  <followup>${followup
    .map(
      (fc) => `
    <comment author="${fc.author.login}">
      <body><![CDATA[${fc.body}]]></body>
    </comment>`,
    )
    .join("")}
  </followup>`
      : ""
  }
</comment>`

const renderGeneralComment = (
  comment: Comment,
) => `  <comment author="${comment.author.login}">
    <body><![CDATA[${comment.body}]]></body>
  </comment>`

// Schema definitions and GraphQL query

const CommentsFromJson = Schema.fromJsonString(CommentsData)

const githubReviewCommentsQuery = `
  query FetchPRComments($owner: String!, $repo: String!, $pr: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pr) {
        url
        reviewDecision
        reviewThreads(first: 100) {
          edges {
            node {
              isCollapsed
              isOutdated
              isResolved
              comments(first: 100) {
                nodes {
                  id
                  author { login }
                  body
                  path
                  originalLine
                  diffHunk
                  createdAt
                }
              }
            }
          }
        }
        comments(first: 100) {
          edges {
            node {
              id
              body
              author { login }
              createdAt
            }
          }
        }
      }
    }
  }
`
