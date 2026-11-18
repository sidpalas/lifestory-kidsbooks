import { createHash } from "node:crypto";
import { Config, Context, Effect, Layer } from "effect";

export interface ImageRequest {
  /** Stable key for this generation; the same key must yield the same image. */
  readonly key: string;
  readonly prompt: string;
  readonly width: number;
  readonly height: number;
}

export interface GeneratedImage {
  readonly body: Uint8Array;
  readonly contentType: string;
}

/**
 * The one boundary for image generation. Milestone 1 adds the Modal provider
 * (FLUX 3 Klein, submit then callback) behind this same service; the fake
 * provider is the default for development, tests, and CI.
 */
export class ImageProvider extends Context.Service<
  ImageProvider,
  {
    readonly name: string;
    readonly generate: (request: ImageRequest) => Effect.Effect<GeneratedImage>;
  }
>()("@lifestory/core/ImageProvider") {}

const escapeXml = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

/** Deterministic placeholder: the colour comes from a hash of the key, so reruns are byte-identical. */
export const renderPlaceholder = (request: ImageRequest): GeneratedImage => {
  const hue = createHash("sha256").update(request.key).digest().readUInt16BE(0) % 360;
  const { width, height } = request;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="hsl(${hue} 60% 80%)"/>
<circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 4}" fill="hsl(${(hue + 180) % 360} 50% 60%)"/>
<text x="50%" y="90%" text-anchor="middle" font-family="sans-serif" font-size="${Math.round(height / 20)}" fill="#333">${escapeXml(request.prompt)}</text>
</svg>
`;
  return { body: new TextEncoder().encode(svg), contentType: "image/svg+xml" };
};

export const FakeImageProvider = Layer.succeed(ImageProvider, {
  name: "fake",
  generate: (request) => Effect.sync(() => renderPlaceholder(request)),
});

/**
 * The provider named by IMAGE_PROVIDER (default "fake"). The Modal provider
 * adds "modal" here; until then any other value fails at startup instead of
 * silently generating placeholders.
 */
export const ImageProviderFromConfig = Layer.unwrap(
  Effect.gen(function* () {
    yield* Config.Literals(["fake"], "IMAGE_PROVIDER").pipe(Config.withDefault("fake"));
    return FakeImageProvider;
  }),
);
