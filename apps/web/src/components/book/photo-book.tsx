// A photo book's steps on the book page (D56, D57): consent, a photo per role, the character sheets and cover with up
// to two rounds of changes, "Make my book", then page changes and sending the book for review. Everything here reads
// `view.flow`; while something is being checked or drawn, the page reloads its data every two seconds.
import {
  type BookView,
  consentStatements,
  type DataRetention,
  type Hair,
  hairColours,
  hairLengths,
  hairTextures,
  MAX_LIKENESS_ROUNDS,
  MAX_PAGE_CHANGES,
  unwrapResult,
} from "@lifestory/core/contracts";
import { Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { BookPage, ScaledPage } from "~/components/book/BookPage";
import { Button } from "~/components/ui/button";
import { FileInput } from "~/components/ui/file-input";
import { NativeSelect } from "~/components/ui/native-select";
import { cn } from "~/lib/utils";
import {
  askLikenessChangesFn,
  choosePageVersionFn,
  FlowStepResult,
  orderBookFn,
  recordConsentFn,
  requestPageChangeFn,
  sendForReviewFn,
  withdrawPhotoReviewFn,
} from "~/server/photo-books";

type Flow = BookView["flow"];

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const fileUrl = (key: string) => `/api/files/${key}`;

/** Whether the server is still working on something the page shows. */
export const flowBusy = (flow: Flow) =>
  flow.likenesses.some((likeness) => likeness.checkStatus === "checking") ||
  flow.likenessStatus === "drawing" ||
  flow.status === "ordered" ||
  flow.status === "making" ||
  flow.pages.some((page) => !page.ready);

/** Reloads the page's data every two seconds while the server works. */
export function usePollWhileBusy(busy: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void router.invalidate(), 2000);
    return () => clearInterval(timer);
  }, [busy, router]);
}

/** Runs one step, then reloads; returns the error message, if any. */
function useStep() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const run = async (call: () => Promise<unknown>) => {
    setError(null);
    setPending(true);
    try {
      unwrapResult(FlowStepResult)((await call()) as never);
      await router.invalidate();
      return true;
    } catch (cause) {
      setError(message(cause));
      return false;
    } finally {
      setPending(false);
    }
  };
  return { error, pending, run };
}

function Alert({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className="text-sm text-destructive">
      {text}
    </p>
  ) : null;
}

/** The book's current step, above the editor. */
export function PhotoBookSteps({ view, canEdit }: { view: BookView; canEdit: boolean }) {
  const { flow } = view;
  usePollWhileBusy(flowBusy(flow));
  if (flow.status === "draft") {
    if (!canEdit)
      return <Notice title="Being made">Someone in your family is putting the family into this book.</Notice>;
    if (!flow.consented) return <ConsentStep bookId={view.book.id} retention={flow.retention} />;
    return (
      <div className="flex flex-col gap-6">
        <PhotoStep view={view} />
        <PreviewStep view={view} />
      </div>
    );
  }
  if (flow.status === "ordered" || flow.status === "making") {
    const drawn = flow.pages.filter((page) => page.ready).length;
    return (
      <Notice title="Drawing your book">
        Ordered. We're drawing every page from your characters: {drawn} of {flow.pages.length || "…"} pages so far. This
        takes about a minute.
      </Notice>
    );
  }
  if (flow.status === "changes") return <ChangesStep view={view} canEdit={canEdit} />;
  if (flow.status === "in_review")
    return (
      <Notice title="With our team">
        We're reviewing your book before it's printed. We'll email you if anything needs changing.
        <PhotoReviewNote view={view} canEdit={canEdit} />
      </Notice>
    );
  if (flow.status === "approved")
    return <Notice title="Approved for print">We approved your book. Your approved proof is the file we print.</Notice>;
  return (
    <Notice title="We can't print this book">
      {flow.reviewNote ?? "Our team couldn't approve it."} Reply to our email with any questions.
    </Notice>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1 rounded-md border bg-muted/40 p-4 text-sm" data-testid="book-step">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

const Policies = () => (
  <span>
    See our{" "}
    <Link to="/policies/$policy" params={{ policy: "terms" }} className="underline">
      terms
    </Link>
    ,{" "}
    <Link to="/policies/$policy" params={{ policy: "privacy" }} className="underline">
      privacy policy
    </Link>{" "}
    and{" "}
    <Link to="/policies/$policy" params={{ policy: "child-safety" }} className="underline">
      child safety and AI policy
    </Link>
    .
  </span>
);

function ConsentStep({ bookId, retention }: { bookId: string; retention: DataRetention }) {
  const statements = consentStatements(retention);
  const [ticked, setTicked] = useState<ReadonlyArray<string>>([]);
  const { error, pending, run } = useStep();
  const ready = statements.every((s) => !s.required || ticked.includes(s.id));
  return (
    <section className="flex flex-col gap-3 rounded-md border p-4 text-sm" data-testid="book-step">
      <h2 className="text-base font-semibold">Before you add photos</h2>
      <p className="text-muted-foreground">
        You'll add one photo of each person, and we draw them into the story. <Policies />
      </p>
      {statements.map((statement) => (
        <label key={statement.id} className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={ticked.includes(statement.id)}
            onChange={(event) =>
              setTicked(event.target.checked ? [...ticked, statement.id] : ticked.filter((id) => id !== statement.id))
            }
          />
          <span>{statement.text}</span>
        </label>
      ))}
      <Button
        className="w-fit"
        disabled={!ready || pending}
        onClick={() => run(() => recordConsentFn({ data: { bookId, statements: ticked } }))}
      >
        Agree and add photos
      </Button>
      <Alert text={error} />
    </section>
  );
}

/** Resizes a photo to at most 1536 px and drops its metadata, in the browser (D56). */
const preparePhoto = async (file: File) => {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("This photo's format can't be read here. Save it as a JPEG and try again.");
  });
  const scale = Math.min(1, 1536 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read the photo."))), "image/jpeg", 0.9),
  );
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
};

const photoTypes = ["image/jpeg", "image/png", "image/webp", "image/heic"];
/** The file picker's types; some systems give a dropped HEIC no type, so its extension counts too. */
const isPhotoFile = (file: File) => photoTypes.includes(file.type) || /\.hei[cf]$/i.test(file.name);
const isFileDrag = (event: { dataTransfer: DataTransfer | null }) =>
  event.dataTransfer?.types.includes("Files") ?? false;

const defaultHair: Hair = { colour: "brown", length: "short", texture: "straight" };

function PhotoStep({ view }: { view: BookView }) {
  // A file dropped beside a photo card would make the browser open it in place of the page; refuse it instead.
  useEffect(() => {
    const refuse = (event: DragEvent) => {
      if (event.defaultPrevented || !isFileDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
    };
    window.addEventListener("dragover", refuse);
    window.addEventListener("drop", refuse);
    return () => {
      window.removeEventListener("dragover", refuse);
      window.removeEventListener("drop", refuse);
    };
  }, []);
  return (
    <section className="flex flex-col gap-3" aria-labelledby="photos-heading" data-testid="book-step">
      <h2 id="photos-heading" className="text-base font-semibold">
        A photo of each person
      </h2>
      <p className="text-sm text-muted-foreground">
        One person, facing the camera, in good light. We check each photo in a few seconds.
      </p>
      <div className="grid items-start gap-3 md:grid-cols-2">
        {view.manifest.characterSlots.map((slot) => (
          <PhotoCard key={slot.slotId} view={view} slotId={slot.slotId} />
        ))}
      </div>
      <PhotoReviewNote view={view} canEdit />
    </section>
  );
}

function PhotoCard({ view, slotId }: { view: BookView; slotId: string }) {
  const router = useRouter();
  const slot = view.manifest.characterSlots.find((candidate) => candidate.slotId === slotId)!;
  const role = view.roles.find((candidate) => candidate.slotId === slotId);
  const likeness = view.flow.likenesses.find((candidate) => candidate.slotId === slotId)!;
  const [hair, setHair] = useState<Hair>(likeness.hair ?? defaultHair);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const upload = async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", await preparePhoto(file));
      form.set("slotId", slotId);
      form.set("hair", JSON.stringify(hair));
      const response = await fetch(`/api/books/${view.book.id}/photos`, {
        method: "POST",
        headers: { "x-lifestory-upload": "1" },
        body: form,
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The upload failed.");
      await router.invalidate();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setUploading(false);
    }
  };

  // Dropping a file on the card does what choosing it does; each person has exactly one photo, so a drop of several
  // files uploads none and says why.
  const name = role?.person.name ?? slot.label;
  const drop = (files: ReadonlyArray<File>) => {
    if (uploading) return setError(`Wait for ${name}'s photo to finish uploading.`);
    if (files.length !== 1)
      return setError(`That's ${files.length} files. Drop one photo of ${name}: we use one photo of each person.`);
    if (!isPhotoFile(files[0]!)) return setError("That isn't a photo we can use. Drop a JPEG, PNG, WebP or HEIC.");
    void upload(files[0]!);
  };

  const check = likeness.check;
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-md border p-3 text-sm",
        dragging && "border-dashed border-primary bg-accent",
      )}
      data-testid={`photo-${slotId}`}
      onDragOver={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        setDragging(false);
        drop([...event.dataTransfer.files]);
      }}
    >
      <p className="font-medium">
        {slot.label}: {role?.person.name}
      </p>
      <div className="grid grid-cols-3 gap-2">
        <NativeSelect
          aria-label={`${slot.label}'s hair colour`}
          value={hair.colour}
          onChange={(event) => setHair({ ...hair, colour: event.target.value as Hair["colour"] })}
        >
          {hairColours.map((colour) => (
            <option key={colour.id} value={colour.id}>
              {colour.label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={`${slot.label}'s hair length`}
          value={hair.length}
          onChange={(event) => setHair({ ...hair, length: event.target.value as Hair["length"] })}
        >
          {hairLengths.map((length) => (
            <option key={length.id} value={length.id}>
              {length.label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={`${slot.label}'s hair texture`}
          value={hair.texture}
          onChange={(event) => setHair({ ...hair, texture: event.target.value as Hair["texture"] })}
        >
          {hairTextures.map((texture) => (
            <option key={texture.id} value={texture.id}>
              {texture.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <FileInput
        label={`Photo of ${role?.person.name ?? slot.label}`}
        buttonText={likeness.photoKey ? "Choose another photo" : "Choose a photo"}
        emptyText={likeness.photoKey ? "Photo added" : undefined}
        accept={photoTypes.join(",")}
        disabled={uploading}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void upload(file);
        }}
      />
      <p className="text-xs text-muted-foreground pointer-coarse:hidden">
        {dragging ? `Drop the photo of ${name}` : "Or drag a photo onto this card."}
      </p>
      {likeness.photoKey && (
        <img src={fileUrl(likeness.photoKey)} alt={`Photo of ${role?.person.name}`} className="h-28 w-fit rounded" />
      )}
      <p data-testid={`photo-status-${slotId}`} className="text-xs">
        {uploading
          ? "Uploading…"
          : likeness.checkStatus === "checking"
            ? "Checking the photo…"
            : likeness.checkStatus === "passed"
              ? "This photo works."
              : likeness.checkStatus === "refused"
                ? "We can't use this photo."
                : "No photo yet."}
      </p>
      {check?.refusals.map((issue) => (
        <p key={issue.code} className="text-xs text-destructive">
          {issue.message}
        </p>
      ))}
      {check?.warnings.map((issue) => (
        <p key={issue.code} className="text-xs text-amber-700">
          {issue.message}
        </p>
      ))}
      <Alert text={error} />
    </div>
  );
}

function PhotoReviewNote({ view, canEdit }: { view: BookView; canEdit: boolean }) {
  const { error, pending, run } = useStep();
  if (!view.flow.photoReview) return null;
  return (
    <p className="text-xs text-muted-foreground">
      You let our team see the photos while reviewing this book; they're deleted when it's approved.{" "}
      {canEdit && (
        <button
          type="button"
          className="underline"
          disabled={pending}
          onClick={() => run(() => withdrawPhotoReviewFn({ data: { bookId: view.book.id } }))}
        >
          Withdraw and delete them
        </button>
      )}
      <Alert text={error} />
    </p>
  );
}

function PreviewStep({ view }: { view: BookView }) {
  const { flow, manifest } = view;
  const [notes, setNotes] = useState<Record<string, string>>({});
  const changes = useStep();
  const order = useStep();
  if (flow.likenessStatus === "waiting") return null;
  if (flow.likenessStatus === "drawing")
    return (
      <Notice title="Drawing your characters">
        Each person's character sheet, then a cover with everyone on it: about 45 seconds.
      </Notice>
    );
  if (flow.likenessStatus === "failed")
    return (
      <Notice title="We couldn't draw the characters">
        Try another photo, or reply to any of our emails and we'll look into it.
      </Notice>
    );
  const coverIndex = flow.cover ? manifest.pages.findIndex((page) => page.pageId === flow.cover!.pageId) : -1;
  const roundsLeft = MAX_LIKENESS_ROUNDS - flow.likenessRound;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="preview-heading" data-testid="book-step">
      <h2 id="preview-heading" className="text-base font-semibold">
        Your characters
      </h2>
      <div className="grid gap-3 md:grid-cols-2">
        {manifest.characterSlots.map((slot) => {
          const likeness = flow.likenesses.find((candidate) => candidate.slotId === slot.slotId)!;
          const role = view.roles.find((candidate) => candidate.slotId === slot.slotId);
          return (
            <figure key={slot.slotId} className="flex flex-col gap-2 rounded-md border p-3 text-sm">
              {likeness.sheetKey && (
                <img
                  src={fileUrl(likeness.sheetKey)}
                  alt={`${role?.person.name}'s character sheet`}
                  className="w-full rounded"
                  data-testid={`sheet-${slot.slotId}`}
                />
              )}
              <figcaption>{role?.person.name}</figcaption>
              {roundsLeft > 0 && (
                <textarea
                  aria-label={`What to change about ${role?.person.name}`}
                  placeholder="Anything to change? For example: curlier hair, freckles."
                  className="min-h-16 rounded-md border bg-transparent p-2 text-sm"
                  value={notes[slot.slotId] ?? ""}
                  maxLength={300}
                  onChange={(event) => setNotes({ ...notes, [slot.slotId]: event.target.value })}
                />
              )}
            </figure>
          );
        })}
      </div>
      {flow.cover && coverIndex >= 0 && (
        <div className="w-fit rounded-sm shadow ring-1 ring-black/10" data-testid="cover">
          <ScaledPage trim={manifest.trim} scale={0.4}>
            <BookPage
              manifest={manifest}
              page={manifest.pages[coverIndex]!}
              text={view.pages[coverIndex]!.text.map((block) => ({ style: block.style, text: block.text }))}
              illustration={flow.cover.layers.map((layer) => ({ url: fileUrl(layer.key), rect: layer.rect }))}
              cast={view.cast}
            />
          </ScaledPage>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {roundsLeft > 0 && (
          <Button
            variant="outline"
            disabled={changes.pending || Object.values(notes).every((note) => note.trim() === "")}
            onClick={async () => {
              if (await changes.run(() => askLikenessChangesFn({ data: { bookId: view.book.id, notes } })))
                setNotes({});
            }}
          >
            Ask for these changes ({roundsLeft} {roundsLeft === 1 ? "round" : "rounds"} left)
          </Button>
        )}
        <Button
          disabled={order.pending}
          onClick={() => order.run(() => orderBookFn({ data: { bookId: view.book.id } }))}
        >
          Make my book
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        "Make my book" places your order: we draw every page from these characters and delete the photos
        {flow.photoReview ? " once our team has reviewed the book" : ""}. You can then change up to {MAX_PAGE_CHANGES}{" "}
        pages. <Policies />
      </p>
      <Alert text={changes.error ?? order.error} />
    </section>
  );
}

function ChangesStep({ view, canEdit }: { view: BookView; canEdit: boolean }) {
  const { error, pending, run } = useStep();
  const used = view.flow.pages.filter((page) => page.latestVersion > 1).length;
  return (
    <Notice title="Read your book">
      <p>
        Every page is drawn. You can change up to {MAX_PAGE_CHANGES} pages ({MAX_PAGE_CHANGES - used} left), edit the
        text, then approve a proof and send the book to us for review before it's printed.
      </p>
      {canEdit && (
        <Button
          className="w-fit"
          disabled={pending}
          onClick={() => run(() => sendForReviewFn({ data: { bookId: view.book.id } }))}
        >
          Send for review
        </Button>
      )}
      <PhotoReviewNote view={view} canEdit={canEdit} />
      <Alert text={error} />
    </Notice>
  );
}

/** Under the shown page: ask for a change to it, or choose between its versions (D57). */
export function PageChange({ view, pageId, canEdit }: { view: BookView; pageId: string; canEdit: boolean }) {
  const page = view.flow.pages.find((candidate) => candidate.pageId === pageId);
  const [note, setNote] = useState("");
  const { error, pending, run } = useStep();
  if (!page || view.flow.status !== "changes" || !canEdit) return null;
  const used = view.flow.pages.filter((candidate) => candidate.latestVersion > 1).length;
  const index = view.manifest.pages.findIndex((candidate) => candidate.pageId === pageId);
  if (page.latestVersion > 1) {
    if (!page.ready) return <p className="text-sm">Redrawing this page: "{page.changeNote}"…</p>;
    return (
      <div className="flex flex-col gap-2 text-sm" data-testid="page-versions">
        <p>You asked: "{page.changeNote}". Keep the one you like.</p>
        <div className="flex flex-wrap gap-3">
          {page.versions.map((version) => (
            <div key={version.version} className="flex flex-col items-start gap-1">
              <span className="w-fit rounded-sm ring-1 ring-black/10">
                <ScaledPage trim={view.manifest.trim} scale={0.2}>
                  <BookPage
                    manifest={view.manifest}
                    page={view.manifest.pages[index]!}
                    text={view.pages[index]!.text.map((block) => ({ style: block.style, text: block.text }))}
                    illustration={version.layers.map((layer) => ({ url: fileUrl(layer.key), rect: layer.rect }))}
                    cast={view.cast}
                  />
                </ScaledPage>
              </span>
              <Button
                size="sm"
                variant={version.version === page.chosenVersion ? "default" : "outline"}
                disabled={pending || version.version === page.chosenVersion}
                onClick={() =>
                  run(() => choosePageVersionFn({ data: { bookId: view.book.id, pageId, version: version.version } }))
                }
              >
                {version.version === page.chosenVersion
                  ? "Chosen"
                  : version.version === 1
                    ? "Keep the original"
                    : "Use the new one"}
              </Button>
            </div>
          ))}
        </div>
        <Alert text={error} />
      </div>
    );
  }
  if (used >= MAX_PAGE_CHANGES) return null;
  return (
    <form
      className="flex flex-col gap-2 text-sm"
      onSubmit={async (event) => {
        event.preventDefault();
        if (await run(() => requestPageChangeFn({ data: { bookId: view.book.id, pageId, note } }))) setNote("");
      }}
    >
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">
          Change the drawing on this page ({MAX_PAGE_CHANGES - used} of {MAX_PAGE_CHANGES} left). For something wrong on
          every page, such as the hair, write to us instead.
        </span>
        <textarea
          aria-label="What to change on this page"
          className="min-h-16 rounded-md border bg-transparent p-2 text-sm"
          value={note}
          maxLength={300}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <Button type="submit" size="sm" className="w-fit" disabled={pending || note.trim() === ""}>
        Redraw this page
      </Button>
      <Alert text={error} />
    </form>
  );
}
