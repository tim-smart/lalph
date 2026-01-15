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
import { IssueSource } from "./IssueSource.ts"
import { ChildProcess } from "effect/unstable/process"

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

    console.log({ owner, repo })

    const issues = yield* github
      .stream((rest, page) =>
        rest.issues.listForRepo({
          owner,
          repo,
          state: "open",
          per_page: 100,
          page,
        }),
      )
      .pipe(
        Stream.filter((issue) => issue.pull_request === undefined),
        Stream.runCollect,
      )

    console.log("found issues:", issues)

    return yield* Effect.never
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
