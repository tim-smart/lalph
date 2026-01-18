import {
  DateTime,
  Deferred,
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
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http"
import { Base64Url } from "effect/encoding"
import { NodeHttpServer } from "@effect/platform-node"
import { createServer } from "node:http"
import { KeyValueStore } from "effect/unstable/persistence"
import { layerKvs } from "../Kvs.ts"

const clientId = "852ed0906088135c1f591d234a4eaa4b"

export class TokenManager extends ServiceMap.Service<TokenManager>()(
  "lalph/Linear/TokenManager",
  {
    make: Effect.gen(function* () {
      const kvs = KeyValueStore.prefix(
        yield* KeyValueStore.KeyValueStore,
        "linear.accessToken",
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
          const newToken = yield* pkce
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

      const pkce = Effect.gen(function* () {
        const deferred = yield* Deferred.make<typeof CallbackParams.Type>()

        const CallbackRoute = HttpRouter.add(
          "GET",
          "/callback",
          Effect.gen(function* () {
            const params = yield* callbackParams
            yield* Deferred.succeed(deferred, params)
            return yield* HttpServerResponse.html`
<html>
  <body style="font-family: sans-serif; text-align: center; margin-top: 50px;">
    <h1>Lalph login Successful</h1>
    <p>You can close this window now.</p>
  </body>
</html>
`
          }),
        )
        yield* HttpRouter.serve(CallbackRoute, {
          disableListenLog: true,
          disableLogger: true,
        }).pipe(
          Layer.provide(NodeHttpServer.layer(createServer, { port: 34338 })),
          Layer.build,
          Effect.orDie,
        )
        const redirectUri = `http://localhost:34338/callback`

        // client
        const verifier = crypto.randomUUID()
        const verifierSha256 = yield* Effect.promise(() =>
          crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
        )
        const challenge = Base64Url.encode(new Uint8Array(verifierSha256))

        const url = `https://linear.app/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=read,write&code_challenge=${challenge}&code_challenge_method=S256`

        console.log("Open this URL to login to Linear:", url)

        const params = yield* Deferred.await(deferred)

        const res = yield* HttpClientRequest.post(
          "https://api.linear.app/oauth/token",
        ).pipe(
          HttpClientRequest.bodyUrlParams({
            code: params.code,
            redirect_uri: redirectUri,
            client_id: clientId,
            code_verifier: verifier,
            grant_type: "authorization_code",
          }),
          httpClient.execute,
          Effect.flatMap(HttpClientResponse.schemaBodyJson(TokenResponse)),
        )

        return AccessToken.fromResponse(res)
      }).pipe(Effect.scoped)

      const refresh = Effect.fnUntraced(function* (token: AccessToken) {
        const res = yield* HttpClientRequest.post(
          "https://api.linear.app/oauth/token",
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
  "lalph/Linear/AccessToken",
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

  readonly expiresAtEarly = this.expiresAt.pipe(
    DateTime.subtract({ minutes: 30 }),
  )

  isExpired(): boolean {
    return DateTime.isPastUnsafe(this.expiresAtEarly)
  }
}

const CallbackParams = Schema.Struct({
  code: Schema.String,
})
const callbackParams = HttpServerRequest.schemaSearchParams(CallbackParams)

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  token_type: Schema.String,
  expires_in: Schema.Number,
  refresh_token: Schema.String,
  scope: Schema.String,
})
