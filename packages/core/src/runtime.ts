import { Layer, ManagedRuntime } from "effect";
import { Auth } from "./auth.ts";
import { AppConfig } from "./config.ts";
import { Database } from "./database.ts";
import { FakeImageProvider } from "./image-provider.ts";
import { Jobs } from "./jobs.ts";
import { ObjectStorage } from "./storage.ts";

/**
 * Every server-side service, wired once. The web server and the worker each
 * build one ManagedRuntime from this layer and run all their Effects through it.
 * The fake image provider is the only provider until milestone 1 adds Modal.
 */
export const ServerLayer = Layer.mergeAll(Auth.layer, Jobs.layer, ObjectStorage.layer, FakeImageProvider).pipe(
  Layer.provideMerge(Database.layer),
  Layer.provideMerge(AppConfig.layer),
);

export type ServerServices = Layer.Success<typeof ServerLayer>;

export const makeServerRuntime = () => ManagedRuntime.make(ServerLayer);
export type ServerRuntime = ReturnType<typeof makeServerRuntime>;
