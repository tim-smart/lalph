import type { Api } from "@octokit/plugin-rest-endpoint-methods"
import type { OctokitResponse } from "@octokit/types"
import {
  Config,
  Data,
  Effect,
  Layer,
  Option,
  pipe,
  Redacted,
  ServiceMap,
  Stream,
  String,
} from "effect"
import { Octokit } from "octokit"
import { IssueSource, IssueSourceError } from "./IssueSource.ts"
import { ChildProcess } from "effect/unstable/process"
import { PrdIssue } from "./domain/PrdIssue.ts"

export class GithubError extends Data.TaggedError("GithubError")<{
  readonly cause: unknown
}> {}

export class Github extends ServiceMap.Service<Github>()("lalph/Github", {
  make: Effect.gen(function* () {
    const token = yield* Config.redacted("GITHUB_TOKEN").pipe(
      Config.orElse(() => Config.redacted("GH_TOKEN")),
    )
    const octokit = new Octokit({ auth: Redacted.value(token) })

    const rest = octokit.rest

    const request = <A>(f: (_: Api["rest"]) => Promise<A>) =>
      Effect.withSpan(
        Effect.tryPromise({
          try: () => f(rest as any),
          catch: (cause) => new GithubError({ cause }),
        }),
        "Github.request",
      )

    const wrap =
      <A, Args extends Array<any>>(
        f: (_: Api["rest"]) => (...args: Args) => Promise<OctokitResponse<A>>,
      ) =>
      (...args: Args) =>
        Effect.map(
          Effect.tryPromise({
            try: () => f(rest as any)(...args),
            catch: (cause) => new GithubError({ cause }),
          }),
          (_) => _.data,
        )

    const stream = <A>(
      f: (_: Api["rest"], page: number) => Promise<OctokitResponse<Array<A>>>,
    ) =>
      Stream.paginate(0, (page) =>
        Effect.map(
          Effect.tryPromise({
            try: () => f(rest as any, page),
            catch: (cause) => new GithubError({ cause }),
          }),
          (_) => [_.data, maybeNextPage(page, _.headers.link)],
        ),
      )

    return { token, request, wrap, stream } as const
  }),
}) {
  static layer = Layer.effect(this, this.make)
}

export const GithubIssueSource = Layer.effect(
  IssueSource,
  Effect.gen(function* () {
    const github = yield* Github
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
        Effect.mapError((_) => new GithubRepoNotFound()),
      )
    const [owner, repo] = nameWithOwner.split("/") as [string, string]

    const states = new Map([
      ["open", { id: "open", name: "Open", kind: "unstarted" as const }],
      ["closed", { id: "closed", name: "Closed", kind: "completed" as const }],
    ])

    const issues = github
      .stream((rest, page) =>
        rest.issues.listForRepo({
          owner,
          repo,
          state: "all",
          per_page: 100,
          page,
        }),
      )
      .pipe(
        Stream.filter((issue) => issue.pull_request === undefined),
        Stream.map(
          (issue) =>
            new PrdIssue({
              id: issue.number.toString(),
              title: issue.title,
              description: issue.body ?? "",
              priority: 3,
              estimate: null,
              stateId: issue.state === "closed" ? "closed" : "open",
              complete: issue.state === "closed",
              blockedBy: [],
            }),
        ),
        Stream.runCollect,
        Effect.mapError((cause) => new IssueSourceError({ cause })),
      )

    const createIssue = github.wrap((rest) => rest.issues.create)

    return IssueSource.of({
      states: Effect.succeed(states),
      issues,
      createIssue: Effect.fnUntraced(
        function* (issue: PrdIssue) {
          const created = yield* createIssue({
            owner,
            repo,
            title: issue.title,
            body: issue.description,
          })
          return created.number.toString()
        },
        Effect.mapError((cause) => new IssueSourceError({ cause })),
      ),
      updateIssue: Effect.fnUntraced(
        function* (options) {
          if (options.stateId && !states.has(options.stateId)) {
            return yield* Effect.fail(
              new IssueSourceError({
                cause: new Error(`Unknown GitHub stateId: ${options.stateId}`),
              }),
            )
          }

          const update: {
            owner: string
            repo: string
            issue_number: number
            title?: string
            body?: string
            state?: "open" | "closed"
          } = {
            owner,
            repo,
            issue_number: Number(options.issueId),
          }

          if (options.title !== undefined) {
            update.title = options.title
          }

          if (options.description !== undefined) {
            update.body = options.description
          }

          if (options.stateId !== undefined) {
            update.state = options.stateId === "closed" ? "closed" : "open"
          }

          yield* github.wrap((rest) => rest.issues.update)(update)
        },
        Effect.mapError((cause) => new IssueSourceError({ cause })),
      ),
      cancelIssue: Effect.fnUntraced(function* () {
        return yield* Effect.fail(
          new IssueSourceError({
            cause: new Error("GitHub issue cancellation not implemented"),
          }),
        )
      }),
    })
  }),
).pipe(Layer.provide(Github.layer))

export class GithubRepoNotFound extends Data.TaggedError("GithubRepoNotFound") {
  readonly message = "GitHub repository not found"
}

// == helpers

const maybeNextPage = (page: number, linkHeader?: string) =>
  pipe(
    Option.fromNullishOr(linkHeader),
    Option.filter((_) => _.includes(`rel="next"`)),
    Option.as(page + 1),
  )
