import { Config, Effect, Layer, ManagedRuntime } from "effect";
import { Auth } from "./auth.ts";
import { AppConfig } from "./config.ts";
import { Database } from "./database.ts";
import { Generations } from "./generations.ts";
import { FakeImageProvider } from "./image-provider.ts";
import { Jobs } from "./jobs.ts";
import { Mailer } from "./mailer.ts";
import { ModalImageProvider } from "./providers/modal.ts";
import { OpenAIImageProvider } from "./providers/openai.ts";
import { ObjectStorage } from "./storage.ts";

/**
 * IMAGE_PROVIDER picks the provider: `fake` (the default; development, tests, CI), `openai` (the primary for part
 * generation, D30), or `modal` (FLUX 3 Klein, the fallback).
 */
const ImageProviderLayer = Layer.unwrap(
  Effect.map(
    Config.Literals(["fake", "openai", "modal"], "IMAGE_PROVIDER").pipe(Config.withDefault("fake" as const)),
    (provider) => ({ fake: FakeImageProvider, openai: OpenAIImageProvider, modal: ModalImageProvider })[provider],
  ),
);

/**
 * Every server-side service, wired once. The web server and the worker each
 * build one ManagedRuntime from this layer and run all their Effects through it.
 */
export const ServerLayer = ImageProviderLayer.pipe(
  Layer.provideMerge(Layer.mergeAll(Auth.layer, Jobs.layer, ObjectStorage.layer, Generations.layer)),
  Layer.provideMerge(Mailer.layer),
  Layer.provideMerge(Database.layer),
  Layer.provideMerge(AppConfig.layer),
);

export type ServerServices = Layer.Success<typeof ServerLayer>;

export const makeServerRuntime = () => ManagedRuntime.make(ServerLayer);
export type ServerRuntime = ReturnType<typeof makeServerRuntime>;
