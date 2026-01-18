import {
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Schedule,
  Schema,
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
import { layerKvs } from "../Kvs.ts"

const clientId = "Iv23li5pna7yejMFlPRo"

export class TokenManager extends ServiceMap.Service<TokenManager>()(
  "lalph/Github/TokenManager",
  {
    make: Effect.gen(function* () {
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
      const set = (token: AccessToken) =>
        Effect.orDie(tokenStore.set("", token))
      const clear = Effect.orDie(tokenStore.remove(""))

      const getNoLock: Effect.Effect<
        AccessToken,
        HttpClientError.HttpClientError | Schema.SchemaError
      > = Effect.gen(function* () {
        if (Option.isNone(currentToken)) {
          const newToken = yield* deviceCode
          yield* set(newToken)
          return newToken
        } else if (currentToken.value.isExpired()) {
          const newToken = yield* refresh(currentToken.value)
          if (Option.isNone(newToken)) {
            yield* clear
            return yield* getNoLock
          }
          yield* set(newToken.value)
          currentToken = newToken
          return newToken.value
        }
        return currentToken.value
      })
      const get = Effect.makeSemaphoreUnsafe(1).withPermit(getNoLock)

      const deviceCode = Effect.gen(function* () {
        const code = yield* HttpClientRequest.post(
          "https://github.com/login/device/code",
        ).pipe(
          HttpClientRequest.bodyUrlParams({ client_id: clientId }),
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

      const refresh = Effect.fnUntraced(function* (token: AccessToken) {
        const res = yield* HttpClientRequest.post(
          "https://github.com/login/oauth/access_token",
        ).pipe(
          HttpClientRequest.bodyUrlParams({
            refresh_token: token.refreshToken,
            client_id: clientId,
            grant_type: "refresh_token",
          }),
          httpClient.execute,
          Effect.flatMap(HttpClientResponse.schemaBodyJson(TokenResponse)),
        )
        return AccessToken.fromResponse(res)
      }, Effect.option)

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
  expiresAt: Schema.DateTimeUtc,
  refreshToken: Schema.String,
}) {
  static fromResponse(res: typeof TokenResponse.Type): AccessToken {
    return new AccessToken({
      token: res.access_token,
      refreshToken: res.refresh_token,
      expiresAt: DateTime.nowUnsafe().pipe(
        DateTime.add({ seconds: res.expires_in }),
      ),
    })
  }

  isExpired(): boolean {
    return DateTime.isPastUnsafe(
      this.expiresAt.pipe(DateTime.subtract({ minutes: 30 })),
    )
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
  expires_in: Schema.NumberFromString,
  refresh_token: Schema.String,
  scope: Schema.String,
})

const PollResponse = Schema.Union([TokenResponse, PollErrorResponse])
