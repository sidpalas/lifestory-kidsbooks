import { Config, Context, Effect, Layer } from "effect";

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
      const provider = yield* Config.Literals(["log"], "EMAIL_PROVIDER").pipe(Config.withDefault("log" as const));
      return Mailer.make(yield* providers[provider]);
    }),
  );
}
