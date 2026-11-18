import { Context, Effect, Layer } from "effect";

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
 * Sends the app's emails (invitations and set-password links). There is no
 * delivery provider yet (docs/decisions.md D23): every email is logged, and the
 * last 50 are kept in memory for the development mailbox at /__dev/mailbox.
 */
export class Mailer extends Context.Service<
  Mailer,
  {
    readonly send: (email: Email) => Effect.Effect<void>;
    /** Sent emails, newest first. Only this process's, and lost on restart. */
    readonly outbox: Effect.Effect<ReadonlyArray<SentEmail>>;
  }
>()("@lifestory/core/Mailer") {
  static readonly log = Layer.sync(Mailer, () => {
    const sent: Array<SentEmail> = [];
    return {
      send: (email) =>
        Effect.sync(() => {
          sent.unshift({ ...email, sentAt: new Date() });
          sent.length = Math.min(sent.length, 50);
        }).pipe(Effect.andThen(Effect.logInfo(`email to ${email.to}: ${email.subject} ${email.link}`))),
      outbox: Effect.sync(() => [...sent]),
    };
  });
}
