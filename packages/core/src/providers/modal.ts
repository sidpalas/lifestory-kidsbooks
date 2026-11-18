import { createHmac, timingSafeEqual } from "node:crypto";
import { Config, Effect, Layer, Redacted } from "effect";
import { GenerationFailed } from "../errors.ts";
import { ImageProvider } from "../image-provider.ts";
import { ObjectStorage } from "../storage.ts";

// The Modal provider: FLUX 3 Image Klein in modal/flux_klein.py. Submissions and callbacks are signed with
// HMAC-SHA256 over the raw body, keyed by MODAL_CALLBACK_SECRET (the same value as Modal's `lifestory-modal` secret).

export const signatureHeader = "x-lifestory-signature";
export const modalCallbackPath = "/api/webhooks/modal";

export const signBody = (secret: string, body: string) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

export const verifySignature = (secret: string, body: string, signature: string | null) => {
  const expected = Buffer.from(signBody(secret, body));
  const actual = Buffer.from(signature ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

/** Presigned URLs must outlive Modal's queue and a cold start; SigV4 allows up to 7 days. */
const urlLifetimeSeconds = 6 * 60 * 60;

export const ModalImageProvider = Layer.effect(
  ImageProvider,
  Effect.gen(function* () {
    const endpoint = yield* Config.String("MODAL_ENDPOINT_URL");
    const secret = yield* Config.Redacted("MODAL_CALLBACK_SECRET");
    const appUrl = yield* Config.String("PUBLIC_APP_URL");
    const storage = yield* ObjectStorage;

    return {
      name: "modal",
      extension: "png",
      submit: (job) =>
        Effect.gen(function* () {
          const fail = (message: string) => new GenerationFailed({ generationId: job.generationId, message });
          const presign = (...args: Parameters<typeof storage.presign>) =>
            storage.presign(...args).pipe(Effect.mapError((error) => fail(error.message)));
          const body = JSON.stringify({
            generationId: job.generationId,
            prompt: job.prompt,
            width: job.width,
            height: job.height,
            seed: job.seed,
            references: yield* Effect.forEach(job.references, (key) =>
              presign(key, "GET", { expiresInSeconds: urlLifetimeSeconds }),
            ),
            outputUrl: yield* presign(job.outputKey, "PUT", {
              expiresInSeconds: urlLifetimeSeconds,
              contentType: "image/png",
            }),
            callbackUrl: new URL(modalCallbackPath, appUrl).toString(),
          });
          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(endpoint, {
                method: "POST",
                headers: { "content-type": "application/json", [signatureHeader]: signBody(Redacted.value(secret), body) },
                body,
                signal: AbortSignal.timeout(60_000),
              }),
            catch: (error) => fail(`submit failed: ${String(error)}`),
          });
          const text = yield* Effect.promise(() => response.text());
          if (!response.ok) return yield* fail(`submit returned ${response.status}: ${text.slice(0, 300)}`);
          const { callId } = JSON.parse(text) as { callId: string };
          return { externalId: callId };
        }),
    };
  }),
);
