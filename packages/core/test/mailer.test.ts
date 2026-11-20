import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { ConfigProvider, Effect, Exit, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Mailer } from "../src/mailer.ts";

// A stand-in for Resend's API: records each request and answers with the next status in `statuses`.
const requests: Array<{ path: string; authorization: string | undefined; body: unknown }> = [];
const statuses: Array<number> = [];
const readBody = async (request: IncomingMessage) => {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  return body;
};
const server = createServer(async (request, response) => {
  requests.push({
    path: request.url ?? "",
    authorization: request.headers.authorization,
    body: JSON.parse(await readBody(request)),
  });
  const status = statuses.shift() ?? 200;
  response
    .writeHead(status, { "content-type": "application/json" })
    .end(status === 200 ? '{"id":"email_1"}' : '{"message":"domain not verified"}');
});
beforeAll(() => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)));
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const send = (env: Record<string, string>) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      yield* Mailer.use((mailer) =>
        mailer.send({
          to: "gran@example.com",
          subject: "You're invited",
          text: "Choose a password:",
          link: "https://app.test/set-password/t0k",
        }),
      );
      return yield* Mailer.use((mailer) => mailer.outbox);
    }).pipe(Effect.provide(Mailer.layer.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))))),
  );

const resendEnv = () => ({
  EMAIL_PROVIDER: "resend",
  RESEND_API_KEY: "re_test_key",
  EMAIL_FROM: "Lifestory <hello@mail.example.com>",
  RESEND_BASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
});

describe("Mailer with EMAIL_PROVIDER=resend", () => {
  it("posts the email, with its link in the text, to Resend's API", async () => {
    requests.length = 0;
    const exit = await send(resendEnv());
    expect(Exit.isSuccess(exit) && exit.value.map((email) => email.to)).toEqual(["gran@example.com"]);
    expect(requests).toEqual([
      {
        path: "/emails",
        authorization: "Bearer re_test_key",
        body: {
          from: "Lifestory <hello@mail.example.com>",
          to: ["gran@example.com"],
          subject: "You're invited",
          text: "Choose a password:\n\nhttps://app.test/set-password/t0k\n",
        },
      },
    ]);
  });

  it("fails the send when Resend refuses it, so the invite doesn't report success", async () => {
    statuses.push(403);
    const exit = await send(resendEnv());
    expect(Exit.isFailure(exit)).toBe(true);
    expect(String(Exit.isFailure(exit) && exit.cause)).toContain("Resend refused the email to gran@example.com (403)");
  });
});
