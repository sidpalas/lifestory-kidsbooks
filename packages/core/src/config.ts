import { Config, Context, Effect, Layer, Redacted } from "effect";

/** Process configuration, read once from the environment. See .env.example. */
export class AppConfig extends Context.Service<
  AppConfig,
  {
    readonly databaseUrl: Redacted.Redacted<string>;
    readonly s3: {
      readonly endpoint: string;
      readonly region: string;
      readonly bucket: string;
      readonly accessKeyId: string;
      readonly secretAccessKey: Redacted.Redacted<string>;
    };
  }
>()("@lifestory/core/AppConfig") {
  static readonly layer = Layer.effect(
    AppConfig,
    Effect.gen(function* () {
      return {
        databaseUrl: yield* Config.Redacted("DATABASE_URL"),
        s3: {
          endpoint: yield* Config.String("S3_ENDPOINT"),
          region: yield* Config.String("S3_REGION").pipe(Config.withDefault("us-east-1")),
          bucket: yield* Config.String("S3_BUCKET"),
          accessKeyId: yield* Config.String("S3_ACCESS_KEY_ID"),
          secretAccessKey: yield* Config.Redacted("S3_SECRET_ACCESS_KEY"),
        },
      };
    }),
  );
}
