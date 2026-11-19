import { Config, Context, Effect, Layer, Redacted } from "effect";

/** Process configuration, read once from the environment. See .env.example. */
export class AppConfig extends Context.Service<
  AppConfig,
  {
    readonly databaseUrl: Redacted.Redacted<string>;
    readonly s3: {
      readonly endpoint: string;
      /** Origin that outside callers (Modal) use in presigned URLs; defaults to `endpoint`. */
      readonly publicEndpoint: string;
      readonly region: string;
      readonly bucket: string;
      readonly accessKeyId: string;
      readonly secretAccessKey: Redacted.Redacted<string>;
      /** Path-style URLs (endpoint/bucket/key) for SeaweedFS; false for providers that require virtual-hosted style. */
      readonly forcePathStyle: boolean;
    };
    /** The web app's origin as the worker reaches it; headless Chromium opens print pages there for PDF proofs. */
    readonly printAppUrl: string;
  }
>()("@lifestory/core/AppConfig") {
  static readonly layer = Layer.effect(
    AppConfig,
    Effect.gen(function* () {
      const endpoint = yield* Config.String("S3_ENDPOINT");
      return {
        databaseUrl: yield* Config.Redacted("DATABASE_URL"),
        s3: {
          endpoint,
          publicEndpoint: yield* Config.String("S3_PUBLIC_ENDPOINT").pipe(Config.withDefault(endpoint)),
          region: yield* Config.String("S3_REGION").pipe(Config.withDefault("us-east-1")),
          bucket: yield* Config.String("S3_BUCKET"),
          accessKeyId: yield* Config.String("S3_ACCESS_KEY_ID"),
          secretAccessKey: yield* Config.Redacted("S3_SECRET_ACCESS_KEY"),
          forcePathStyle: yield* Config.Boolean("S3_FORCE_PATH_STYLE").pipe(Config.withDefault(true)),
        },
        printAppUrl: yield* Config.String("PRINT_APP_URL").pipe(Config.withDefault("http://localhost:3000")),
      };
    }),
  );
}
