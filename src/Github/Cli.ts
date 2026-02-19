import {
  Data,
  Effect,
  flow,
  Layer,
  Option,
  Schema,
  ServiceMap,
  String,
} from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import {
  Comment,
  GithubPullRequestData,
  ReviewComment,
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
          Effect.flatMap(
            flow(
              Option.map(String.trim),
              Option.filter(String.isNonEmpty),
              Option.match({
                onNone: () => Effect.fail(new GithubCliRepoNotFound()),
                onSome: (value) => Effect.succeed(value),
              }),
            ),
          ),
        )
      const [owner, repo] = nameWithOwner.split("/") as [string, string]

      const reviewComments = (pr: number) =>
        ChildProcess.make`gh api graphql -f owner=${owner} -f repo=${repo} -F pr=${pr} -f query=${githubReviewCommentsQuery}`.pipe(
          ChildProcess.string,
          Effect.flatMap(Schema.decodeEffect(PullRequestDataFromJson)),
          Effect.map((data) => {
            const comments =
              data.data.repository.pullRequest.comments.nodes.filter(
                (c) => !c.isBot,
              )
            const reviews =
              data.data.repository.pullRequest.reviews.nodes.filter(
                (r) => r.body.trim().length > 0,
              )
            const reviewThreads =
              data.data.repository.pullRequest.reviewThreads.nodes
            return { comments, reviews, reviewThreads } as const
          }),
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            spawner,
          ),
        )

      const prFeedbackMd = (pr: number) =>
        reviewComments(pr).pipe(
          Effect.map(({ comments, reviewThreads, reviews }) => {
            const eligibleReviewThreads = reviewThreads.filter(
              (thread) => thread.shouldDisplayThread,
            )

            if (
              comments.length === 0 &&
              eligibleReviewThreads.length === 0 &&
              reviews.length === 0
            ) {
              return `No review comments found.`
            }

            let content = `# PR feedback

Comments are rendered in XML format.`

            if (eligibleReviewThreads.length > 0) {
              const reviewCommentsMd = eligibleReviewThreads
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

            if (reviews.length > 0) {
              const reviewsXml = reviews
                .map(
                  (review) => `<review author="${review.author.login}">
  <body>${review.body}</body>
</review>`,
                )
                .join("\n")
              content += `

## Reviews

<reviews>
${reviewsXml}
</reviews>`
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

export class GithubCliRepoNotFound extends Data.TaggedError(
  "GithubCliRepoNotFound",
) {
  readonly message =
    "GitHub repository not found. Ensure the current directory is inside a git repo with a GitHub remote."
}

// markdown helper functions

const renderReviewComments = (
  comment: ReviewComment,
  followup: Array<ReviewComment>,
) => `<comment author="${comment.author.login}" path="${comment.path}">
  <diffHunk><![CDATA[
${comment.diffHunk}
  ]]></diffHunk>
  ${comment.originalLine ? `<lineNumber>${comment.originalLine}</lineNumber>` : ""}
  <body>${comment.body}</body>${
    followup.length > 0
      ? `

  <followup>${followup
    .map(
      (fc) => `
    <comment author="${fc.author.login}">
      <body>${fc.body}</body>
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
    <body>${comment.body}</body>
  </comment>`

// Schema definitions and GraphQL query

const PullRequestDataFromJson = Schema.fromJsonString(GithubPullRequestData)

const githubReviewCommentsQuery = `
query FetchPRComments($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      url
      reviewDecision
      reviews(first: 100) {
        nodes {
          id
          author {
            login
          }
          body
        }
      }
      reviewThreads(first: 100) {
        nodes {
          isCollapsed
          isOutdated
          isResolved
          comments(first: 100) {
            nodes {
              id
              author {
                login
              }
              body
              path
              originalLine
              diffHunk
              createdAt
            }
          }
        }
      }
      comments(first: 100) {
        nodes {
          id
          body
          author {
            login
          }
          createdAt
        }
      }
    }
  }
}
`
