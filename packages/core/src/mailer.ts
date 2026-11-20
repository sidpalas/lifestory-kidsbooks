import { Config, Context, Effect, Layer, Redacted } from "effect";

export interface Email {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  /** The one link the email is about, such as an invitation. */
  readonly link: string;
}

export interface SentEmail extends Email {
  readonly sentAt: Date;
}

/**
 * Hands one email to a delivery provider. This is the seam a provider plugs into (docs/decisions.md D23):
 * a new provider is one more entry in `providers` below, chosen by EMAIL_PROVIDER.
 */
type Deliver = (email: Email) => Effect.Effect<void>;

const providers = {
  /** No delivery (the default, D23): the link goes to the server log, where the operator copies it in production. */
  log: Effect.succeed<Deliver>((email) => Effect.logInfo(`email to ${email.to}: ${email.subject} ${email.link}`)),
  /**
   * Resend's HTTPS API (D39). EMAIL_FROM must be on a domain verified in Resend. A failed send is a defect, so the
   * invite fails visibly; the link is logged with the error, so the operator can still copy it from the log.
   */
  resend: Effect.gen(function* () {
    const apiKey = yield* Config.Redacted("RESEND_API_KEY");
    const from = yield* Config.String("EMAIL_FROM");
    const endpoint = yield* Config.String("RESEND_BASE_URL").pipe(Config.withDefault("https://api.resend.com"));
    return (email: Email) =>
      Effect.promise(async () => {
        const response = await fetch(`${endpoint}/emails`, {
          method: "POST",
          headers: { authorization: `Bearer ${Redacted.value(apiKey)}`, "content-type": "application/json" },
          body: JSON.stringify({
            from,
            to: [email.to],
            subject: email.subject,
            text: `${email.text}\n\n${email.link}\n`,
          }),
          signal: AbortSignal.timeout(15_000),
        });
        return { status: response.status, body: (await response.text()).slice(0, 300) };
      }).pipe(
        // A network failure is reported like a refusal, with the link in the log.
        Effect.catchDefect((error) => Effect.succeed({ status: 0, body: String(error) })),
        Effect.flatMap(({ status, body }) =>
          status >= 200 && status < 300
            ? Effect.logInfo(`email to ${email.to}: ${email.subject} (sent with Resend)`)
            : Effect.logError(
                `email to ${email.to} not sent: Resend returned ${status}: ${body}; link: ${email.link}`,
              ).pipe(Effect.andThen(Effect.die(new Error(`Resend refused the email to ${email.to} (${status})`)))),
        ),
      );
  }),
};

/**
 * Sends the app's emails (invitations and set-password links) through the provider EMAIL_PROVIDER names,
 * and keeps the last 50 in memory for the development mailbox at /__dev/mailbox.
 */
export class Mailer extends Context.Service<
  Mailer,
  {
    readonly send: (email: Email) => Effect.Effect<void>;
    /** Sent emails, newest first. Only this process's, and lost on restart. */
    readonly outbox: Effect.Effect<ReadonlyArray<SentEmail>>;
  }
>()("@lifestory/core/Mailer") {
  static readonly make = (deliver: Deliver) =>
    Layer.sync(Mailer, () => {
      const sent: Array<SentEmail> = [];
      return {
        send: (email) =>
          deliver(email).pipe(
            Effect.andThen(
              Effect.sync(() => {
                sent.unshift({ ...email, sentAt: new Date() });
                sent.length = Math.min(sent.length, 50);
              }),
            ),
          ),
        outbox: Effect.sync(() => [...sent]),
      };
    });

  static readonly layer = Layer.unwrap(
    Effect.gen(function* () {
      const provider = yield* Config.Literals(["log", "resend"], "EMAIL_PROVIDER").pipe(
        Config.withDefault("log" as const),
      );
      return Mailer.make(yield* providers[provider]);
    }),
  );
}
