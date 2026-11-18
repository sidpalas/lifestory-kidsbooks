// Better Auth's HTTP API (sign-in, sign-out, organizations, invitations).
import { Auth } from "@lifestory/core";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { serverRuntime } from "~/server/runtime";

const handle = async ({ request }: { request: Request }) => {
  const { auth } = await serverRuntime().runPromise(Auth.use((service) => Effect.succeed(service)));
  return auth.handler(request);
};

export const Route = createFileRoute("/api/auth/$")({
  server: { handlers: { GET: handle, POST: handle } },
});
