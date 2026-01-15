import type { Api } from "@octokit/plugin-rest-endpoint-methods"
import type { OctokitResponse } from "@octokit/types"
import {
  Config,
  Data,
  DateTime,
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
      [
        "in-progress",
        { id: "in-progress", name: "In progress", kind: "started" as const },
      ],
      [
        "in-review",
        { id: "in-review", name: "In review", kind: "completed" as const },
      ],
      ["closed", { id: "closed", name: "Closed", kind: "completed" as const }],
    ])

    const hasLabel = (
      label: ReadonlyArray<
        | string
        | {
            readonly name?: string
          }
      >,
      name: string,
    ): boolean =>
      label.some((l) => (typeof l === "string" ? l === name : l.name === name))

    const listOpenBlockedBy = (issueId: number) =>
      github
        .stream((rest, page) =>
          rest.issues.listDependenciesBlockedBy({
            owner,
            repo,
            issue_number: issueId,
            per_page: 100,
            page,
          }),
        )
        .pipe(Stream.filter((issue) => issue.state === "open"))

    const issues = github
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
        Stream.merge(
          github.stream((rest, page) =>
            rest.issues.listForRepo({
              owner,
              repo,
              state: "closed",
              per_page: 100,
              page,
              since: DateTime.nowUnsafe().pipe(
                DateTime.subtract({ days: 3 }),
                DateTime.formatIso,
              ),
            }),
          ),
        ),
        Stream.filter((issue) => issue.pull_request === undefined),
        Stream.mapEffect(
          Effect.fnUntraced(function* (issue) {
            const dependencies = yield* listOpenBlockedBy(issue.number).pipe(
              Stream.runCollect,
            )
            return new PrdIssue({
              id: `#${issue.number}`,
              title: issue.title,
              description: issue.body ?? "",
              priority: 0,
              estimate: null,
              stateId:
                issue.state === "closed"
                  ? "closed"
                  : hasLabel(issue.labels, "in-progress")
                    ? "in-progress"
                    : hasLabel(issue.labels, "in-review")
                      ? "in-review"
                      : "open",
              complete: issue.state === "closed",
              blockedBy: dependencies.map((dep) => `#${dep.number}`),
              githubPrNumber: null,
            })
          }),
          { concurrency: 10 },
        ),
        Stream.runCollect,
        Effect.mapError((cause) => new IssueSourceError({ cause })),
      )

    const createIssue = github.wrap((rest) => rest.issues.create)
    const updateIssue = github.wrap((rest) => rest.issues.update)
    const addBlockedByDependency = github.wrap(
      (rest) => rest.issues.addBlockedByDependency,
    )
    const removeBlockedByDependency = github.wrap(
      (rest) => rest.issues.removeDependencyBlockedBy,
    )

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

          const blockedByNumbers = Array.from(
            new Set(
              issue.blockedBy
                .map((id) => Number(id.slice(1)))
                .filter((id) => Number.isFinite(id)),
            ),
          )

          if (blockedByNumbers.length > 0) {
            yield* Effect.forEach(
              blockedByNumbers,
              (dependencyNumber) =>
                addBlockedByDependency({
                  owner,
                  repo,
                  issue_number: created.number,
                  issue_id: dependencyNumber,
                }).pipe(Effect.asVoid),
              { concurrency: 5 },
            )
          }

          return created.number.toString()
        },
        Effect.mapError((cause) => new IssueSourceError({ cause })),
      ),
      updateIssue: Effect.fnUntraced(
        function* (options) {
          if (options.stateId && !states.has(options.stateId)) {
            return yield* new IssueSourceError({
              cause: new Error(`Unknown GitHub stateId: ${options.stateId}`),
            })
          }

          const issueNumber = Number(options.issueId.slice(1))
          const update: {
            owner: string
            repo: string
            issue_number: number
            title?: string
            body?: string
            labels?: string[]
            state?: "open" | "closed"
          } = {
            owner,
            repo,
            issue_number: issueNumber,
          }

          if (options.title !== undefined) {
            update.title = options.title
          }
          if (options.description !== undefined) {
            update.body = options.description
          }
          if (options.stateId !== undefined) {
            update.state = options.stateId === "closed" ? "closed" : "open"

            if (options.stateId === "in-review") {
              update.labels = ["in-review"]
            } else if (options.stateId === "in-progress") {
              update.labels = ["in-progress"]
            } else {
              update.labels = []
            }
          }

          yield* updateIssue(update)

          if (options.blockedBy !== undefined) {
            const desiredBlockedBy = options.blockedBy
            const currentBlockedBy = yield* listOpenBlockedBy(issueNumber).pipe(
              Stream.map((issue) => issue.number),
              Stream.runCollect,
            )
            const currentNumbers = new Set(currentBlockedBy)
            const desiredNumbers = new Set(
              desiredBlockedBy
                .map((id) => Number(id.slice(1)))
                .filter((id) => Number.isFinite(id)),
            )

            const toAdd = desiredBlockedBy.reduce((acc, id) => {
              const dependencyNumber = Number(id.slice(1))
              if (
                Number.isFinite(dependencyNumber) &&
                !currentNumbers.has(dependencyNumber)
              ) {
                acc.push(dependencyNumber)
              }
              return acc
            }, [] as number[])
            const toRemove = currentBlockedBy.filter(
              (dep) => !desiredNumbers.has(dep),
            )

            yield* Effect.forEach(
              toAdd,
              (dependencyNumber) =>
                addBlockedByDependency({
                  owner,
                  repo,
                  issue_number: issueNumber,
                  issue_id: dependencyNumber,
                }),
              { concurrency: 5, discard: true },
            )

            yield* Effect.forEach(
              toRemove,
              (dependency) =>
                removeBlockedByDependency({
                  owner,
                  repo,
                  issue_number: issueNumber,
                  issue_id: dependency,
                }),
              { concurrency: 5, discard: true },
            )
          }
        },

        Effect.mapError((cause) => new IssueSourceError({ cause })),
      ),
      cancelIssue: Effect.fnUntraced(
        function* (issueId: string) {
          yield* updateIssue({
            owner,
            repo,
            issue_number: Number(issueId.slice(1)),
            state: "closed",
          })
        },
        Effect.mapError((cause) => new IssueSourceError({ cause })),
      ),
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
