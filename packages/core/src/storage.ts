import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Context, Effect, Layer, Redacted } from "effect";
import { AppConfig } from "./config.ts";
import { StorageError } from "./errors.ts";

export interface StoredObject {
  readonly body: Uint8Array;
  readonly contentType: string;
}

const fail = (operation: string, key: string) => (cause: unknown) =>
  new StorageError({ operation, key, message: cause instanceof Error ? cause.message : String(cause) });

/**
 * S3-compatible object storage (SeaweedFS locally, any S3 API in production).
 * Writes are keyed by the caller, so repeating a put with the same key is
 * idempotent; workflow steps rely on that.
 */
export class ObjectStorage extends Context.Service<
  ObjectStorage,
  {
    readonly put: (key: string, body: Uint8Array, contentType: string) => Effect.Effect<void, StorageError>;
    readonly get: (key: string) => Effect.Effect<StoredObject, StorageError>;
    readonly ensureBucket: Effect.Effect<void, StorageError>;
  }
>()("@lifestory/core/ObjectStorage") {
  static readonly layer = Layer.effect(
    ObjectStorage,
    Effect.gen(function* () {
      const { s3 } = yield* AppConfig;
      const client = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new S3Client({
              endpoint: s3.endpoint,
              region: s3.region,
              forcePathStyle: s3.forcePathStyle,
              credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: Redacted.value(s3.secretAccessKey) },
            }),
        ),
        (s3Client) => Effect.sync(() => s3Client.destroy()),
      );

      return {
        put: (key, body, contentType) =>
          Effect.tryPromise({
            try: () => client.send(new PutObjectCommand({ Bucket: s3.bucket, Key: key, Body: body, ContentType: contentType })),
            catch: fail("put", key),
          }).pipe(Effect.asVoid),
        get: (key) =>
          Effect.tryPromise({
            try: async () => {
              const out = await client.send(new GetObjectCommand({ Bucket: s3.bucket, Key: key }));
              if (!out.Body) throw new Error("empty body");
              return {
                body: await out.Body.transformToByteArray(),
                contentType: out.ContentType ?? "application/octet-stream",
              };
            },
            catch: fail("get", key),
          }),
        ensureBucket: Effect.tryPromise({
          try: async () => {
            try {
              await client.send(new HeadBucketCommand({ Bucket: s3.bucket }));
            } catch {
              await client.send(new CreateBucketCommand({ Bucket: s3.bucket }));
            }
          },
          catch: fail("ensureBucket", s3.bucket),
        }),
      };
    }),
  );
}
