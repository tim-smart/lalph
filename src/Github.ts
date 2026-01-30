import type { Api } from "@octokit/plugin-rest-endpoint-methods"
import type { OctokitResponse } from "@octokit/types"
import {
  Data,
  DateTime,
  Effect,
  Layer,
  Option,
  pipe,
  RcMap,
  Schedule,
  Schema,
  ServiceMap,
  Stream,
  String,
} from "effect"
import { Octokit } from "octokit"
import { IssueSource, IssueSourceError } from "./IssueSource.ts"
import { PrdIssue } from "./domain/PrdIssue.ts"
import { Setting } from "./Settings.ts"
import { Prompt } from "effect/unstable/cli"
import { TokenManager } from "./Github/TokenManager.ts"
import { GithubCli } from "./Github/Cli.ts"
import { Reactivity } from "effect/unstable/reactivity"

export class GithubError extends Data.TaggedError("GithubError")<{
  readonly cause: unknown
}> {}

export class Github extends ServiceMap.Service<Github>()("lalph/Github", {
  make: Effect.gen(function* () {
    const tokens = yield* TokenManager
    const clients = yield* RcMap.make({
      lookup: (token: string) =>
        Effect.succeed(new Octokit({ auth: token }).rest),
      idleTimeToLive: "1 minute",
    })
    const getClient = tokens.get.pipe(
      Effect.flatMap(({ token }) => RcMap.get(clients, token)),
      Effect.mapError((cause) => new GithubError({ cause })),
    )

    const request = <A>(f: (_: Api["rest"]) => Promise<A>) =>
      getClient.pipe(
        Effect.flatMap((rest) =>
          Effect.tryPromise({
            try: () => f(rest),
            catch: (cause) => new GithubError({ cause }),
          }),
        ),
        Effect.scoped,
        Effect.withSpan("Github.request"),
      )

    const wrap =
      <A, Args extends Array<unknown>>(
        f: (_: Api["rest"]) => (...args: Args) => Promise<OctokitResponse<A>>,
      ) =>
      (...args: Args) =>
        getClient.pipe(
          Effect.flatMap((rest) =>
            Effect.tryPromise({
              try: () => f(rest)(...args),
              catch: (cause) => new GithubError({ cause }),
            }),
          ),
          Effect.scoped,
          Effect.map((_) => _.data),
          Effect.withSpan("Github.wrap"),
        )

    const stream = <A>(
      f: (_: Api["rest"], page: number) => Promise<OctokitResponse<Array<A>>>,
    ) =>
      Stream.paginate(0, (page) =>
        getClient.pipe(
          Effect.flatMap((rest) =>
            Effect.tryPromise({
              try: () => f(rest, page),
              catch: (cause) => new GithubError({ cause }),
            }),
          ),
          Effect.scoped,
          Effect.map(
            (_) => [_.data, maybeNextPage(page, _.headers.link)] as const,
          ),
        ),
      )

    return { request, wrap, stream } as const
  }),
}) {
  static layer = Layer.effect(this, this.make).pipe(
    Layer.provide(TokenManager.layer),
  )
}

export const GithubIssueSource = Layer.effect(
  IssueSource,
  Effect.gen(function* () {
    const github = yield* Github
    const cli = yield* GithubCli
    const labelFilter = yield* getOrSelectLabel
    const autoMergeLabelName = yield* getOrSelectAutoMergeLabel

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
            owner: cli.owner,
            repo: cli.repo,
            issue_number: issueId,
            per_page: 100,
            page,
          }),
        )
        .pipe(Stream.filter((issue) => issue.state === "open"))

    const recentlyClosed = github
      .stream((rest, page) =>
        rest.issues.listForRepo({
          owner: cli.owner,
          repo: cli.repo,
          state: "closed",
          per_page: 100,
          page,
          labels: Option.getOrUndefined(labelFilter),
          since: DateTime.nowUnsafe().pipe(
            DateTime.subtract({ days: 3 }),
            DateTime.formatIso,
          ),
        }),
      )
      .pipe(Stream.filter((issue) => issue.state_reason !== "not_planned"))

    const issues = github
      .stream((rest, page) =>
        rest.issues.listForRepo({
          owner: cli.owner,
          repo: cli.repo,
          state: "open",
          per_page: 100,
          page,
          labels: Option.getOrUndefined(labelFilter),
        }),
      )
      .pipe(
        Stream.merge(recentlyClosed),
        Stream.filter((issue) => issue.pull_request === undefined),
        Stream.mapEffect(
          Effect.fnUntraced(function* (issue) {
            const dependencies = yield* listOpenBlockedBy(issue.number).pipe(
              Stream.runCollect,
            )
            const state: PrdIssue["state"] =
              issue.state === "closed"
                ? "done"
                : hasLabel(issue.labels, "in-progress")
                  ? "in-progress"
                  : hasLabel(issue.labels, "in-review")
                    ? "in-review"
                    : "todo"
            return new PrdIssue({
              id: `#${issue.number}`,
              title: issue.title,
              description: issue.body ?? "",
              priority: 0,
              estimate: null,
              state,
              blockedBy: dependencies.map((dep) => `#${dep.number}`),
              autoMerge: autoMergeLabelName.pipe(
                Option.map((labelName) => hasLabel(issue.labels, labelName)),
                Option.getOrElse(() => false),
              ),
            })
          }),
          { concurrency: 10 },
        ),
        Stream.runCollect,
        Effect.mapError((cause) => new IssueSourceError({ cause })),
      )

    const createIssue = github.wrap((rest) => rest.issues.create)
    const updateIssue = github.wrap((rest) => rest.issues.update)

    const addBlockedByDependency = Effect.fnUntraced(function* (options: {
      readonly issueNumber: number
      readonly blockedByNumber: number
    }) {
      const blockedBy = yield* github.request((rest) =>
        rest.issues.get({
          owner: cli.owner,
          repo: cli.repo,
          issue_number: options.blockedByNumber,
        }),
      )
      yield* github.request((rest) =>
        rest.issues.addBlockedByDependency({
          owner: cli.owner,
          repo: cli.repo,
          issue_number: options.issueNumber,
          issue_id: blockedBy.data.id,
        }),
      )
    })

    const removeBlockedByDependency = Effect.fnUntraced(function* (options: {
      readonly issueNumber: number
      readonly blockedByNumber: number
    }) {
      const blockedBy = yield* github.request((rest) =>
        rest.issues.get({
          owner: cli.owner,
          repo: cli.repo,
          issue_number: options.blockedByNumber,
        }),
      )
      yield* github.request((rest) =>
        rest.issues.removeDependencyBlockedBy({
          owner: cli.owner,
          repo: cli.repo,
          issue_number: options.issueNumber,
          issue_id: blockedBy.data.id,
        }),
      )
    })

    return yield* IssueSource.make({
      issues,
      createIssue: Effect.fnUntraced(
        function* (issue: PrdIssue) {
          const created = yield* createIssue({
            owner: cli.owner,
            repo: cli.repo,
            title: issue.title,
            body: issue.description,
            labels: [
              ...Option.toArray(labelFilter),
              ...(issue.autoMerge ? Option.toArray(autoMergeLabelName) : []),
            ],
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
                  issueNumber: created.number,
                  blockedByNumber: dependencyNumber,
                }),
              { concurrency: 5, discard: true },
            )
          }

          yield* Effect.sleep(2000)

          return {
            id: `#${created.number}`,
            url: created.html_url,
          }
        },
        Effect.mapError((cause) => new IssueSourceError({ cause })),
      ),
      updateIssue: Effect.fnUntraced(
        function* (options) {
          const issueNumber = Number(options.issueId.slice(1))
          const update: {
            owner: string
            repo: string
            issue_number: number
            title?: string
            body?: string
            labels: string[]
            state?: "open" | "closed"
          } = {
            owner: cli.owner,
            repo: cli.repo,
            issue_number: issueNumber,
            labels: Option.toArray(labelFilter),
          }

          if (options.title) {
            update.title = options.title
          }
          if (options.description) {
            update.body = options.description
          }
          if (options.state) {
            update.state = options.state === "done" ? "closed" : "open"

            if (options.state === "in-review") {
              update.labels.push("in-review")
            } else if (options.state === "in-progress") {
              update.labels.push("in-progress")
            }
          }
          if (options.autoMerge !== undefined) {
            if (options.autoMerge) {
              update.labels.push(...Option.toArray(autoMergeLabelName))
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
                  issueNumber,
                  blockedByNumber: dependencyNumber,
                }),
              { concurrency: 5, discard: true },
            )

            yield* Effect.forEach(
              toRemove,
              (dependency) =>
                removeBlockedByDependency({
                  issueNumber,
                  blockedByNumber: dependency,
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
            owner: cli.owner,
            repo: cli.repo,
            issue_number: Number(issueId.slice(1)),
            state: "closed",
          })
        },
        Effect.mapError((cause) => new IssueSourceError({ cause })),
      ),
      status: Effect.sync(() => {
        console.log(`Issue source: GitHub Issues`)
        console.log(`Repository: ${cli.owner}/${cli.repo}`)
        console.log(
          `Label filter: ${Option.match(labelFilter, {
            onNone: () => "None",
            onSome: (value) => value,
          })}`,
        )
        console.log(
          `Auto-merge label: ${Option.match(autoMergeLabelName, {
            onNone: () => "Disabled",
            onSome: (value) => value,
          })}`,
        )
      }),
      ensureInProgress: Effect.fnUntraced(
        function* (issueId: string) {
          const issueNumber = Number(issueId.slice(1))
          yield* pipe(
            github.request((rest) =>
              rest.issues.get({
                owner: cli.owner,
                repo: cli.repo,
                issue_number: issueNumber,
              }),
            ),
            Effect.repeat({
              until: (r) => hasLabel(r.data.labels, "in-progress"),
              schedule: Schedule.spaced("1 second"),
            }),
          )
        },
        Effect.mapError((cause) => new IssueSourceError({ cause })),
      ),
    })
  }),
).pipe(Layer.provide([Github.layer, GithubCli.layer, Reactivity.layer]))

export class GithubRepoNotFound extends Data.TaggedError("GithubRepoNotFound") {
  readonly message = "GitHub repository not found"
}

// == label filter

const labelFilter = new Setting(
  "github.labelFilter",
  Schema.Option(Schema.String),
)
const labelSelect = Effect.gen(function* () {
  const label = yield* Prompt.text({
    message:
      "What label do you want to filter issues by? (leave empty for none)",
  })
  const labelOption = Option.some(label.trim()).pipe(
    Option.filter(String.isNonEmpty),
  )
  yield* labelFilter.set(Option.some(labelOption))
  return labelOption
})
const getOrSelectLabel = Effect.gen(function* () {
  const label = yield* labelFilter.get
  if (Option.isSome(label)) {
    return label.value
  }
  return yield* labelSelect
})

// == auto merge label

const autoMergeLabel = new Setting(
  "github.autoMergeLabel",
  Schema.Option(Schema.String),
)
const autoMergeLabelSelect = Effect.gen(function* () {
  const label = yield* Prompt.text({
    message:
      "What label do you want to use for auto-mergable issues? (leave empty for none)",
  })
  const labelOption = Option.some(label.trim()).pipe(
    Option.filter(String.isNonEmpty),
  )
  yield* autoMergeLabel.set(Option.some(labelOption))
  return labelOption
})
const getOrSelectAutoMergeLabel = Effect.gen(function* () {
  const label = yield* autoMergeLabel.get
  if (Option.isSome(label)) {
    return label.value
  }
  return yield* autoMergeLabelSelect
})

export const resetGithub = labelFilter
  .set(Option.none())
  .pipe(Effect.andThen(autoMergeLabel.set(Option.none())))

// == helpers

const maybeNextPage = (page: number, linkHeader?: string) =>
  pipe(
    Option.fromNullishOr(linkHeader),
    Option.filter((_) => _.includes(`rel="next"`)),
    Option.as(page + 1),
  )
