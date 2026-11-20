import { parseArgs } from "node:util";

// Creates the operator account, once, inside a deployed container (docs/decisions.md D21).
// Production images have no mise; run it with plain Node from the web image's /app, like migrate.ts:
//   node packages/core/src/operator-create.ts --email you@example.com [--name "Your Name"]
// Locally, `mise run operator:create -- --email ...` wraps the same command and loads .env.
// Prompts for the password (never read from arguments or the environment), creates the
// user with role "admin" and their one-person family, or promotes an existing user.
// Running it again changes nothing.
import { schema } from "@lifestory/db";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

import { createAccountWithFamily, ensureOwnFamily } from "./accounts.ts";
import { MIN_PASSWORD_LENGTH } from "./contracts.ts";
import { Database } from "./database.ts";
import { makeServerRuntime } from "./runtime.ts";

/** Reads a line without echoing it on a terminal. Piped input (for scripts) is read one line per call. */
const readSecret = (prompt: string, lines: AsyncIterator<string> | undefined): Promise<string> => {
  if (lines) return lines.next().then((line) => (line.done ? "" : line.value));
  const { stdin, stdout } = process;
  stdout.write(prompt);
  return new Promise((resolve) => {
    let value = "";
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\u0003") process.exit(130); // Ctrl-C
        if (char === "\r" || char === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          resolve(value);
          return;
        }
        value = char === "\u007f" ? value.slice(0, -1) : value + char;
      }
    };
    stdin.on("data", onData);
    stdin.resume();
  });
};

const pipedLines = async function* () {
  let buffer = "";
  for await (const chunk of process.stdin) {
    buffer += String(chunk);
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      yield buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
    }
  }
  if (buffer) yield buffer;
};

const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" } } });
const email = values.email?.trim().toLowerCase();
if (!email || !email.includes("@")) {
  console.error("usage: node packages/core/src/operator-create.ts --email <email> [--name <name>]");
  process.exit(2);
}

const runtime = makeServerRuntime();
const existing = await runtime.runPromise(
  Database.query((db) =>
    db.select({ id: schema.user.id, role: schema.user.role }).from(schema.user).where(eq(schema.user.email, email)),
  ),
);

if (existing[0]) {
  const user = existing[0];
  await runtime.runPromise(
    Effect.gen(function* () {
      if (user.role !== "admin")
        yield* Database.query((db) => db.update(schema.user).set({ role: "admin" }).where(eq(schema.user.id, user.id)));
      yield* ensureOwnFamily(user.id);
    }),
  );
  console.log(
    user.role === "admin" ? `${email} is already the operator; nothing changed.` : `${email} is now the operator.`,
  );
} else {
  const lines = process.stdin.isTTY ? undefined : pipedLines();
  const password = await readSecret("Password: ", lines);
  const confirmation = await readSecret("Repeat the password: ", lines);
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exit(1);
  }
  if (password !== confirmation) {
    console.error("The passwords don't match.");
    process.exit(1);
  }
  const name = values.name?.trim() || "Operator";
  await runtime.runPromise(createAccountWithFamily({ name, email, role: "admin", password }));
  console.log(`Created the operator ${email} with the family "${name}'s family".`);
}
await runtime.dispose();
