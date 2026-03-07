import type { Api } from "@octokit/plugin-rest-endpoint-methods"
import type { OctokitResponse } from "@octokit/types"
import {
  Array,
  Cache,
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
  Unify,
} from "effect"
import { Octokit } from "octokit"
import { IssueSource, IssueSourceError } from "./IssueSource.ts"
import { PrdIssue } from "./domain/PrdIssue.ts"
import { CurrentProjectId, ProjectSetting, Settings } from "./Settings.ts"
import { Prompt } from "effect/unstable/cli"
import { TokenManager } from "./Github/TokenManager.ts"
import { GithubCli } from "./Github/Cli.ts"
import { Reactivity } from "effect/unstable/reactivity"
import type { ProjectId } from "./domain/Project.ts"
import type { CliAgentPreset } from "./domain/CliAgentPreset.ts"
import { getPresetsWithMetadata } from "./Presets.ts"

export class GithubError extends Data.TaggedError("GithubError")<{
  readonly cause: unknown
}> {}

export type GithubApi = Api["rest"]
export type GithubResponse<A> = OctokitResponse<A>
type GithubResponseHeaders = OctokitResponse<unknown>["headers"]

export interface GithubService {
  readonly request: <A>(
    f: (_: GithubApi) => Promise<A>,
  ) => Effect.Effect<A, GithubError, never>
  readonly graphql: <A>(
    query: string,
    variables?: Record<string, unknown>,
  ) => Effect.Effect<A, GithubError, never>
  readonly wrap: <A, Args extends Array<unknown>>(
    f: (_: GithubApi) => (...args: Args) => Promise<GithubResponse<A>>,
  ) => (...args: Args) => Effect.Effect<A, GithubError, never>
  readonly stream: <A>(
    f: (_: GithubApi, page: number) => Promise<GithubResponse<Array<A>>>,
  ) => Stream.Stream<A, GithubError, never>
}

type CachedGetResponse = {
  readonly etag: string
  readonly data: unknown
  readonly headers: GithubResponseHeaders
  readonly url: string
}

export class Github extends ServiceMap.Service<Github, GithubService>()(
  "lalph/Github",
  {
    make: Effect.gen(function* () {
      const tokens = yield* TokenManager
      const clients = yield* RcMap.make({
        lookup: (token: string) =>
          Effect.sync(() => {
            const octokit = new Octokit({ auth: token })
            const etagCache = new Map<string, CachedGetResponse>()

            octokit.hook.wrap("request", async (request, options) => {
              if (requestMethod(options) !== "GET") {
                return request(options)
              }

              const key = requestCacheKey(options)
              const cached = etagCache.get(key)
              const ifNoneMatchHeader = cached
                ? {
                    ...options.headers,
                    "if-none-match": cached.etag,
                  }
                : options.headers

              try {
                const response = await request({
                  ...options,
                  headers: ifNoneMatchHeader,
                })
                const etag = etagHeaderValue(response.headers)
                if (etag !== undefined) {
                  etagCache.set(key, {
                    etag,
                    data: response.data,
                    headers: response.headers,
                    url: response.url,
                  })
                }
                return response
              } catch (cause) {
                if (isNotModifiedError(cause) && cached) {
                  return {
                    status: 200,
                    headers: cached.headers,
                    url: cached.url,
                    data: cached.data,
                  }
                }
                throw cause
              }
            })

            return octokit
          }),
        idleTimeToLive: "1 minute",
      })
      const getClient = tokens.get.pipe(
        Effect.flatMap(({ token }) => RcMap.get(clients, token)),
        Effect.mapError((cause) => new GithubError({ cause })),
      )

      const request = <A>(f: (_: GithubApi) => Promise<A>) =>
        getClient.pipe(
          Effect.flatMap((client) =>
            Effect.tryPromise({
              try: () => f(client.rest),
              catch: (cause) => new GithubError({ cause }),
            }),
          ),
          Effect.scoped,
          Effect.withSpan("Github.request"),
        )

      const graphql = <A>(query: string, variables?: Record<string, unknown>) =>
        getClient.pipe(
          Effect.flatMap((client) =>
            Effect.tryPromise({
              try: () => client.graphql<A>(query, variables),
              catch: (cause) => new GithubError({ cause }),
            }),
          ),
          Effect.scoped,
          Effect.withSpan("Github.graphql"),
        )

      const wrap =
        <A, Args extends Array<unknown>>(
          f: (_: GithubApi) => (...args: Args) => Promise<OctokitResponse<A>>,
        ) =>
        (...args: Args) =>
          getClient.pipe(
            Effect.flatMap((client) =>
              Effect.tryPromise({
                try: () => f(client.rest)(...args),
                catch: (cause) => new GithubError({ cause }),
              }),
            ),
            Effect.scoped,
            Effect.map((_) => _.data),
            Effect.withSpan("Github.wrap"),
          )

      const stream = <A>(
        f: (_: GithubApi, page: number) => Promise<OctokitResponse<Array<A>>>,
      ) =>
        Stream.paginate(0, (page) =>
          getClient.pipe(
            Effect.flatMap((client) =>
              Effect.tryPromise({
                try: () => f(client.rest, page),
                catch: (cause) => new GithubError({ cause }),
              }),
            ),
            Effect.scoped,
            Effect.map(
              (_) => [_.data, maybeNextPage(page, _.headers.link)] as const,
            ),
          ),
        )

      return { request, graphql, wrap, stream } as const
    }),
  },
) {
  static layer = Layer.effect(this, this.make).pipe(
    Layer.provide(TokenManager.layer),
  )
}

export const GithubIssueSource = Layer.effect(
  IssueSource,
  Effect.gen(function* () {
    const github = yield* Github
    const cli = yield* GithubCli
    const projectSettings = yield* Cache.make({
      lookup: Effect.fnUntraced(
        function* (_projectId: ProjectId) {
          const labelFilter = yield* getOrSelectLabel
          const projectFilter = yield* getOrSelectProjectFilter
          const autoMergeLabelName = yield* getOrSelectAutoMergeLabel
          return { labelFilter, projectFilter, autoMergeLabelName } as const
        },
        Effect.orDie,
        (effect, projectId) =>
          Effect.provideService(effect, CurrentProjectId, projectId),
      ),
      capacity: Number.POSITIVE_INFINITY,
    })

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

    const matchesLabelFilter = (
      labels: ReadonlyArray<
        | string
        | {
            readonly name?: string
          }
      >,
      labelFilter: Option.Option<string>,
    ): boolean =>
      labelFilter.pipe(
        Option.map((label) => hasLabel(labels, label)),
        Option.getOrElse(() => true),
      )

    const listOpenBlockedBy = (issueId: number) =>
      pipe(
        github.stream((rest, page) =>
          rest.issues.listDependenciesBlockedBy({
            owner: cli.owner,
            repo: cli.repo,
            issue_number: issueId,
            per_page: 100,
            page,
          }),
        ),
        Stream.filter((issue) => issue.state === "open"),
      )

    const recentlyClosed = (labelFilter: Option.Option<string>) =>
      pipe(
        github.stream((rest, page) =>
          rest.issues.listForRepo({
            owner: cli.owner,
            repo: cli.repo,
            state: "closed",
            per_page: 100,
            page,
            since: DateTime.nowUnsafe().pipe(
              DateTime.subtract({ days: 3 }),
              DateTime.formatIso,
            ),
            labels: Option.getOrUndefined(labelFilter),
          }),
        ),
        Stream.filter((issue) => issue.state_reason !== "not_planned"),
      )

    const presets = yield* getPresetsWithMetadata("github", PresetMetadata)
    const issuePresetMap = new Map<string, CliAgentPreset>()

    const projects = Stream.paginate(null, (cursor: string | null) =>
      github
        .graphql<GithubProjectsQuery>(githubProjectsQuery, {
          after: cursor,
        })
        .pipe(
          Effect.map((data) => [
            data.viewer.projectsV2.nodes,
            Option.fromNullOr(data.viewer.projectsV2.pageInfo.endCursor),
          ]),
        ),
    )

    const listProjects = Stream.runCollect(projects).pipe(
      Effect.map((a) =>
        a.sort((left, right) => left.title.localeCompare(right.title)),
      ),
    )

    const projectFilterSelect = Effect.gen(function* () {
      const projects = yield* listProjects
      const selectedProject = yield* Prompt.autoComplete({
        message: "Select a GitHub project to filter issues by",
        choices: [
          {
            title: "No project",
            value: Option.none<GithubProject>(),
          },
        ].concat(
          projects.map((project) => ({
            title: `#${project.number} ${project.title}`,
            description: project.url,
            value: Option.some(project),
          })),
        ),
      })
      yield* Settings.setProject(
        selectedProjectFilter,
        Option.some(selectedProject),
      )
      return selectedProject
    })

    const getOrSelectProjectFilter = Effect.gen(function* () {
      const project = yield* Settings.getProject(selectedProjectFilter)
      if (Option.isSome(project)) {
        return project.value
      }
      return yield* projectFilterSelect
    })

    const repository = `${cli.owner}/${cli.repo}`.toLowerCase()

    const projectIssues = (options: {
      readonly project: GithubProject
      readonly labelFilter: Option.Option<string>
    }) => {
      const threeDaysAgo = DateTime.nowUnsafe().pipe(
        DateTime.subtract({ days: 3 }),
      )
      return Stream.paginate(null, (cursor: string | null) =>
        github
          .graphql<GithubProjectItemsQuery>(githubProjectItemsQuery, {
            projectId: options.project.id,
            after: cursor,
          })
          .pipe(
            Effect.map((data) => [
              data.node.items.nodes.flatMap((item) =>
                isGithubProjectIssue(item.content) ? [item.content] : [],
              ),
              Option.fromNullOr(data.node.items.pageInfo.endCursor),
            ]),
          ),
      ).pipe(
        Stream.filter(
          (issue) =>
            issue.repository.nameWithOwner.toLowerCase() === repository &&
            (!issue.closedAt ||
              DateTime.makeUnsafe(issue.closedAt).pipe(
                DateTime.isGreaterThan(threeDaysAgo),
              )),
        ),
        Stream.map((issue) => ({
          ...issue,
          state: issue.state.toLowerCase(),
          labels: issue.labels.nodes.map((label) => label.name),
        })),
        Stream.filter((issue) =>
          matchesLabelFilter(issue.labels, options.labelFilter),
        ),
      )
    }

    const repoIssues = (options: {
      readonly labelFilter: Option.Option<string>
    }) =>
      pipe(
        github.stream((rest, page) =>
          rest.issues.listForRepo({
            owner: cli.owner,
            repo: cli.repo,
            state: "open",
            per_page: 100,
            page,
            labels: Option.getOrUndefined(options.labelFilter),
          }),
        ),
        Stream.merge(recentlyClosed(options.labelFilter)),
        Stream.filter((issue) => issue.pull_request === undefined),
      )

    const issues = (options: {
      readonly labelFilter: Option.Option<string>
      readonly projectFilter: Option.Option<GithubProject>
      readonly autoMergeLabelName: Option.Option<string>
    }) => {
      const source = Unify.unify(
        Option.isSome(options.projectFilter)
          ? projectIssues({
              project: options.projectFilter.value,
              labelFilter: options.labelFilter,
            })
          : repoIssues(options),
      )

      return pipe(
        source,
        Stream.mapEffect(
          Effect.fnUntraced(function* (issue) {
            const id = `#${issue.number}`
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

            const preset = presets.find(({ metadata }) =>
              hasLabel(issue.labels, metadata.label),
            )
            if (preset) {
              issuePresetMap.set(id, preset.preset)
            }

            return new PrdIssue({
              id,
              title: issue.title,
              description: issue.body ?? "",
              priority: 0,
              estimate: null,
              state,
              blockedBy: dependencies.map((dep) => `#${dep.number}`),
              autoMerge: options.autoMergeLabelName.pipe(
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
    }

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
      issues: Effect.fnUntraced(function* (projectId) {
        const settings = yield* Cache.get(projectSettings, projectId)
        return yield* issues(settings)
      }),
      createIssue: Effect.fnUntraced(
        function* (projectId, issue) {
          const { labelFilter, autoMergeLabelName } = yield* Cache.get(
            projectSettings,
            projectId,
          )
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

          const blockedByNumbers = Array.fromIterable(
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
          const { labelFilter, autoMergeLabelName } = yield* Cache.get(
            projectSettings,
            options.projectId,
          )
          const issueNumber = Number(options.issueId.slice(1))
          const currentIssue = yield* github.request((rest) =>
            rest.issues.get({
              owner: cli.owner,
              repo: cli.repo,
              issue_number: issueNumber,
            }),
          )
          const labels = Array.fromIterable(
            new Set([
              ...currentIssue.data.labels.flatMap((label) =>
                typeof label === "string"
                  ? [label]
                  : label.name
                    ? [label.name]
                    : [],
              ),
              ...Option.toArray(labelFilter),
            ]),
          )
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
            labels,
          }

          if (options.title) {
            update.title = options.title
          }
          if (options.description) {
            update.body = options.description
          }
          if (options.state) {
            update.state = options.state === "done" ? "closed" : "open"

            update.labels = update.labels.filter(
              (label) => label !== "in-review" && label !== "in-progress",
            )

            if (options.state === "in-review") {
              update.labels.push("in-review")
            } else if (options.state === "in-progress") {
              update.labels.push("in-progress")
            }
          }
          if (
            options.autoMerge !== undefined &&
            Option.isSome(autoMergeLabelName)
          ) {
            if (options.autoMerge) {
              if (!update.labels.includes(autoMergeLabelName.value)) {
                update.labels.push(autoMergeLabelName.value)
              }
            } else {
              update.labels = update.labels.filter(
                (label) => label !== autoMergeLabelName.value,
              )
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
        function* (_project, issueId) {
          yield* updateIssue({
            owner: cli.owner,
            repo: cli.repo,
            issue_number: Number(issueId.slice(1)),
            state: "closed",
          })
        },
        Effect.mapError((cause) => new IssueSourceError({ cause })),
      ),
      reset: Effect.gen(function* () {
        const projectId = yield* CurrentProjectId
        yield* Settings.setProject(selectedProjectFilter, Option.none())
        yield* Settings.setProject(labelFilter, Option.none())
        yield* Settings.setProject(autoMergeLabel, Option.none())
        yield* Cache.invalidate(projectSettings, projectId)
      }),
      settings: (projectId) =>
        Effect.asVoid(Cache.get(projectSettings, projectId)),
      info: Effect.fnUntraced(function* (projectId) {
        const { labelFilter, projectFilter, autoMergeLabelName } =
          yield* Cache.get(projectSettings, projectId)
        console.log(
          `  GitHub project: ${Option.match(projectFilter, {
            onNone: () => "None",
            onSome: (value) => `#${value.number} ${value.title}`,
          })}`,
        )
        console.log(
          `  Label filter: ${Option.match(labelFilter, {
            onNone: () => "None",
            onSome: (value) => value,
          })}`,
        )
        console.log(
          `  Auto-merge label: ${Option.match(autoMergeLabelName, {
            onNone: () => "Disabled",
            onSome: (value) => value,
          })}`,
        )
      }),
      issueCliAgentPreset: (issue) =>
        Effect.sync(() =>
          Option.fromUndefinedOr(issuePresetMap.get(issue.id!)),
        ),
      updateCliAgentPreset: Effect.fnUntraced(function* (preset) {
        const label = yield* Prompt.text({
          message: "Enter a label for this preset",
          validate(value) {
            value = value.trim()
            if (value.length === 0) {
              return Effect.fail("Label cannot be empty")
            }
            return Effect.succeed(value)
          },
        })
        return yield* preset.addMetadata("github", PresetMetadata, { label })
      }),
      cliAgentPresetInfo: Effect.fnUntraced(function* (preset) {
        const metadata = yield* preset.decodeMetadata("github", PresetMetadata)
        if (Option.isNone(metadata)) return
        console.log(`  Label: ${metadata.value.label}`)
      }),
      ensureInProgress: Effect.fnUntraced(
        function* (_project, issueId) {
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
).pipe(
  Layer.provide([
    Github.layer,
    GithubCli.layer,
    Reactivity.layer,
    Settings.layer,
  ]),
)

export class GithubRepoNotFound extends Data.TaggedError("GithubRepoNotFound") {
  readonly message = "GitHub repository not found"
}

// == project filter

const GithubProject = Schema.Struct({
  id: Schema.String,
  number: Schema.Number,
  title: Schema.String,
  url: Schema.String,
})
type GithubProject = typeof GithubProject.Type

const selectedProjectFilter = new ProjectSetting(
  "github.projectFilter",
  Schema.Option(GithubProject),
)

// == label filter

const labelFilter = new ProjectSetting(
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
  yield* Settings.setProject(labelFilter, Option.some(labelOption))
  return labelOption
})
const getOrSelectLabel = Effect.gen(function* () {
  const label = yield* Settings.getProject(labelFilter)
  if (Option.isSome(label)) {
    return label.value
  }
  return yield* labelSelect
})

// == auto merge label

const autoMergeLabel = new ProjectSetting(
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
  yield* Settings.setProject(autoMergeLabel, Option.some(labelOption))
  return labelOption
})
const getOrSelectAutoMergeLabel = Effect.gen(function* () {
  const label = yield* Settings.getProject(autoMergeLabel)
  if (Option.isSome(label)) {
    return label.value
  }
  return yield* autoMergeLabelSelect
})

// == preset metadata

const PresetMetadata = Schema.Struct({
  label: Schema.NonEmptyString,
})

// == project helpers

type GithubProjectsQuery = {
  readonly viewer: {
    readonly projectsV2: {
      readonly nodes: ReadonlyArray<{
        readonly id: string
        readonly number: number
        readonly title: string
        readonly closed: boolean
        readonly url: string
      }>
      readonly pageInfo: {
        readonly endCursor: string | null
        readonly hasNextPage: boolean
      }
    }
  }
}

type GithubProjectIssue = {
  readonly __typename: "Issue"
  readonly number: number
  readonly repository: {
    readonly nameWithOwner: string
  }
  readonly title: string
  readonly body: string
  readonly state: string
  readonly labels: {
    readonly nodes: ReadonlyArray<{
      readonly name: string
    }>
  }
  readonly closedAt: string | null
}

type GithubProjectItemContent =
  | GithubProjectIssue
  | {
      readonly __typename: string
    }
  | null

type GithubProjectItemsQuery = {
  readonly node: {
    readonly items: {
      readonly nodes: ReadonlyArray<{
        readonly content: GithubProjectItemContent
      }>
      readonly pageInfo: {
        readonly endCursor: string | null
        readonly hasNextPage: boolean
      }
    }
  }
}

// == helpers

const isGithubProjectIssue = (
  content: GithubProjectItemContent,
): content is GithubProjectIssue =>
  content !== null && content.__typename === "Issue"

const githubProjectsQuery = `
query GithubProjects($after: String) {
  viewer {
    projectsV2(first: 100, after: $after) {
      nodes {
        id
        number
        title
        closed
        url
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
}
`

const githubProjectItemsQuery = `
query GithubProjectItems($projectId: ID!, $after: String) {
  node(id: $projectId) {
    ... on ProjectV2 {
      items(first: 100, after: $after) {
        nodes {
          content {
            __typename
            ... on Issue {
              number
              repository {
                nameWithOwner
              }
              labels(first: 20) {
                nodes {
                  name
                }
              }
              title
              body
              state
              closedAt
            }
          }
        }
        pageInfo {
          endCursor
          hasNextPage
        }
      }
    }
  }
}
`

const maybeNextPage = (page: number, linkHeader?: string) =>
  pipe(
    Option.fromNullishOr(linkHeader),
    Option.filter((_) => _.includes(`rel="next"`)),
    Option.as(page + 1),
  )

const requestMethod = (options: { readonly method?: string }) =>
  options.method?.toUpperCase() ?? "GET"

const requestCacheKey = (options: {
  readonly method?: string
  readonly url?: string
  readonly headers?: Record<string, unknown>
}) => {
  const method = requestMethod(options)
  const url = options.url ?? ""
  const acceptHeader = options.headers?.accept
  const accept = typeof acceptHeader === "string" ? acceptHeader : ""
  return `${method}:${url}:${accept}`
}

const etagHeaderValue = (
  headers: GithubResponseHeaders,
): string | undefined => {
  const etag = headers.etag
  if (typeof etag === "string" && etag.length > 0) {
    return etag
  }
  return undefined
}

const isNotModifiedError = (
  cause: unknown,
): cause is { readonly status: number } =>
  typeof cause === "object" &&
  cause !== null &&
  "status" in cause &&
  (cause as { readonly status: unknown }).status === 304
