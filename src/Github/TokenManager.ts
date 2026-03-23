import {
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Schedule,
  Schema,
  Semaphore,
  ServiceMap,
} from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http"
import { KeyValueStore } from "effect/unstable/persistence"
import { Prompt } from "effect/unstable/cli"
import { layerKvs } from "../Kvs.ts"
import type { QuitError } from "effect/Terminal"

const clientId = "Ov23liJMtg6leTI1Vu6m"

export class TokenManager extends ServiceMap.Service<TokenManager>()(
  "lalph/Github/TokenManager",
  {
    make: Effect.gen(function* () {
      const promptEnv = yield* Effect.services<Prompt.Environment>()
      const kvs = KeyValueStore.prefix(
        yield* KeyValueStore.KeyValueStore,
        "github.accessToken",
      )
      const tokenStore = KeyValueStore.toSchemaStore(kvs, AccessToken)

      const httpClient = (yield* HttpClient.HttpClient).pipe(
        HttpClient.filterStatusOk,
        HttpClient.retryTransient({
          schedule: Schedule.spaced(1000),
        }),
      )

      let currentToken = yield* Effect.orDie(tokenStore.get(""))
      const set = (token: Option.Option<AccessToken>) =>
        Option.match(token, {
          onNone: () =>
            Effect.orDie(tokenStore.remove("")).pipe(
              Effect.map(() => {
                currentToken = Option.none()
              }),
            ),
          onSome: (t) =>
            Effect.orDie(tokenStore.set("", t)).pipe(
              Effect.map(() => {
                currentToken = token
              }),
            ),
        })

      const promptPat = Effect.gen(function* () {
        return yield* Prompt.password({
          message:
            "GitHub PAT with repo, read:user, read:project scopes (leave empty for OAuth)",
          validate: (value) => Effect.succeed(value.trim()),
        })
      }).pipe(Effect.provideServices(promptEnv))

      const getNoLock: Effect.Effect<
        AccessToken,
        HttpClientError.HttpClientError | QuitError | Schema.SchemaError
      > = Effect.gen(function* () {
        if (Option.isSome(currentToken)) {
          return currentToken.value
        }
        const token = Redacted.value(yield* promptPat)
        const accessToken =
          token.length > 0 ? new AccessToken({ token }) : yield* deviceCode
        yield* set(Option.some(accessToken))
        return accessToken
      })
      const get = Semaphore.makeUnsafe(1).withPermit(getNoLock)

      const deviceCode = Effect.gen(function* () {
        const code = yield* HttpClientRequest.post(
          "https://github.com/login/device/code",
        ).pipe(
          HttpClientRequest.bodyUrlParams({
            client_id: clientId,
            scope: "repo read:user read:project",
          }),
          httpClient.execute,
          Effect.flatMap(
            HttpClientResponse.schemaBodyUrlParams(DeviceCodeResponse),
          ),
        )

        console.log("Go to:", code.verification_uri)
        console.log("and enter code:", code.user_code)

        const tokenResponse = yield* HttpClientRequest.post(
          "https://github.com/login/oauth/access_token",
        ).pipe(
          HttpClientRequest.bodyUrlParams({
            client_id: clientId,
            device_code: code.device_code,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
          httpClient.execute,
          Effect.flatMap(HttpClientResponse.schemaBodyUrlParams(PollResponse)),
          Effect.delay(Duration.seconds(code.interval)),
          Effect.repeat({
            until: (res) => "access_token" in res,
          }),
        )

        return AccessToken.fromResponse(tokenResponse)
      })

      return { get } as const
    }),
  },
) {
  static layer = Layer.effect(this, this.make).pipe(
    Layer.provide([layerKvs, FetchHttpClient.layer]),
  )
}

export class AccessToken extends Schema.Class<AccessToken>(
  "lalph/Github/AccessToken",
)({
  token: Schema.String,
}) {
  static fromResponse(res: typeof TokenResponse.Type): AccessToken {
    return new AccessToken({
      token: res.access_token,
    })
  }
}

const DeviceCodeResponse = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri: Schema.String,
  expires_in: Schema.NumberFromString,
  interval: Schema.NumberFromString,
})

const PollErrorResponse = Schema.Struct({
  error: Schema.Literals(["authorization_pending", "slow_down"]),
})

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  token_type: Schema.String,
  scope: Schema.String,
})

const PollResponse = Schema.Union([TokenResponse, PollErrorResponse])
