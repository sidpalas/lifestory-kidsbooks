import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Context, Effect, Layer, Redacted } from "effect";

import { AppConfig } from "./config.ts";
import { StorageError } from "./errors.ts";

export interface StoredObject {
  readonly body: Uint8Array;
  readonly contentType: string;
}

export interface ListedObject {
  readonly key: string;
  readonly lastModified: Date;
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
    /** Copies one object inside the bucket, content type included, without passing its bytes through this process. */
    readonly copy: (from: string, to: string) => Effect.Effect<void, StorageError>;
    /** Every object whose key starts with `prefix`. */
    readonly list: (prefix: string) => Effect.Effect<ReadonlyArray<ListedObject>, StorageError>;
    /** Deletes one object; deleting a missing key succeeds, so a rerun is harmless. */
    readonly delete: (key: string) => Effect.Effect<void, StorageError>;
    readonly ensureBucket: Effect.Effect<void, StorageError>;
    /**
     * A URL that lets a caller without credentials (Modal) GET or PUT one object until it expires.
     * It points at `S3_PUBLIC_ENDPOINT`, so it works from outside the app's network.
     */
    readonly presign: (
      key: string,
      method: "GET" | "PUT",
      options: { readonly expiresInSeconds: number; readonly contentType?: string },
    ) => Effect.Effect<string, StorageError>;
  }
>()("@lifestory/core/ObjectStorage") {
  static readonly layer = Layer.effect(
    ObjectStorage,
    Effect.gen(function* () {
      const { s3 } = yield* AppConfig;
      const makeClient = (endpoint: string, options: { readonly checksums: "WHEN_SUPPORTED" | "WHEN_REQUIRED" }) =>
        Effect.acquireRelease(
          Effect.sync(
            () =>
              new S3Client({
                endpoint,
                region: s3.region,
                forcePathStyle: s3.forcePathStyle,
                credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: Redacted.value(s3.secretAccessKey) },
                requestChecksumCalculation: options.checksums,
              }),
          ),
          (s3Client) => Effect.sync(() => s3Client.destroy()),
        );
      const client = yield* makeClient(s3.endpoint, { checksums: "WHEN_SUPPORTED" });
      // Signing only; it never sends a request, so the public endpoint needn't be reachable from here. By default
      // the SDK signs a CRC32 of the (empty) body into presigned PUT URLs, which makes every real upload fail.
      const publicClient = yield* makeClient(s3.publicEndpoint, { checksums: "WHEN_REQUIRED" });

      return {
        put: (key, body, contentType) =>
          Effect.tryPromise({
            try: () =>
              client.send(new PutObjectCommand({ Bucket: s3.bucket, Key: key, Body: body, ContentType: contentType })),
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
        copy: (from, to) =>
          Effect.tryPromise({
            // CopySource is "<bucket>/<key>", URL-encoded; the slashes between key segments stay.
            try: () =>
              client.send(
                new CopyObjectCommand({
                  Bucket: s3.bucket,
                  Key: to,
                  CopySource: `${s3.bucket}/${from.split("/").map(encodeURIComponent).join("/")}`,
                }),
              ),
            catch: fail("copy", from),
          }).pipe(Effect.asVoid),
        list: (prefix) =>
          Effect.tryPromise({
            try: async () => {
              const objects: Array<ListedObject> = [];
              let token: string | undefined;
              do {
                const page = await client.send(
                  new ListObjectsV2Command({ Bucket: s3.bucket, Prefix: prefix, ContinuationToken: token }),
                );
                for (const object of page.Contents ?? []) {
                  if (object.Key && object.LastModified)
                    objects.push({ key: object.Key, lastModified: object.LastModified });
                }
                token = page.NextContinuationToken;
              } while (token);
              return objects;
            },
            catch: fail("list", prefix),
          }),
        // One DeleteObject per key, not DeleteObjects: Railway's buckets document only the single-object delete.
        delete: (key) =>
          Effect.tryPromise({
            try: () => client.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: key })),
            catch: fail("delete", key),
          }).pipe(Effect.asVoid),
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
        presign: (key, method, { expiresInSeconds, contentType }) =>
          Effect.tryPromise({
            try: () =>
              getSignedUrl(
                publicClient,
                method === "GET"
                  ? new GetObjectCommand({ Bucket: s3.bucket, Key: key })
                  : new PutObjectCommand({ Bucket: s3.bucket, Key: key, ContentType: contentType }),
                { expiresIn: expiresInSeconds },
              ),
            catch: fail(`presign ${method}`, key),
          }),
      };
    }),
  );
}
