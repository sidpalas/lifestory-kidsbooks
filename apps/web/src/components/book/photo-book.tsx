// A photo book's steps on the book page (D56, D57): consent, a photo per role, each person's character sheet drawn
// when the parent asks (three drawings each: the first, then notes or new photos), the cover, "Make my book", then page changes and sending the book for review. Everything here reads
// `view.flow`; while something is being checked or drawn, the page reloads its data every two seconds.
import {
  type BookView,
  consentStatements,
  type DataRetention,
  eyeColours,
  hairColours,
  hairLengths,
  hairTextures,
  type LookChoices,
  type LookKey,
  lookOf,
  type PhotoPose,
  photoPoses,
  skinTones,
  MAX_PAGE_CHANGES,
  MAX_SHEET_DRAWS,
  unwrapResult,
} from "@lifestory/core/contracts";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { CameraIcon } from "lucide-react";
import { type ChangeEvent, useCallback, useEffect, useState } from "react";

import { BookPage, ScaledPage } from "~/components/book/BookPage";
import { type ProofList, ProofPanel } from "~/components/book/ProofPanel";
import { Button } from "~/components/ui/button";
import { FileInput } from "~/components/ui/file-input";
import { NativeSelect } from "~/components/ui/native-select";
import { cn } from "~/lib/utils";
import {
  ApproveProofResult,
  approveProofFn,
  BookProofsResult,
  DeleteProofResult,
  deleteProofFn,
  listBookProofsFn,
  RequestBookProofResult,
  requestBookProofFn,
} from "~/server/books";
import {
  choosePageVersionFn,
  drawSheetFn,
  FlowStepResult,
  orderBookFn,
  recordConsentFn,
  setLookFn,
  requestPageChangeFn,
  sendForReviewFn,
  withdrawPhotoReviewFn,
} from "~/server/photo-books";

type Flow = BookView["flow"];

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const fileUrl = (key: string) => `/api/files/${key}`;

/** Whether the server is still working on something the page shows. */
export const flowBusy = (flow: Flow) =>
  flow.likenesses.some(
    (likeness) =>
      likeness.checkStatus === "checking" ||
      likeness.drawing ||
      likeness.poses.some((pose) => pose.checkStatus === "checking"),
  ) ||
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
      <Notice title="Drawing your book" status={flow.status}>
        Ordered. We're drawing every page from your characters: {drawn} of {flow.pages.length || "…"} pages so far. This
        takes about a minute.
      </Notice>
    );
  }
  if (flow.status === "changes") return <FinishBook view={view} canEdit={canEdit} />;
  const proofs = <BookProofs view={view} canEdit={canEdit} />;
  if (flow.status === "in_review")
    return (
      <Notice title="With our team" status={flow.status}>
        <p>
          You approved your proof and sent the book. We're checking every page before it's printed, and we'll email you
          if anything needs changing. Nothing more to do for now.
        </p>
        <PhotoReviewNote view={view} canEdit={canEdit} />
        {proofs}
      </Notice>
    );
  if (flow.status === "approved")
    return (
      <Notice title="Approved for print" status={flow.status}>
        <p>We approved your book. Your approved proof is the file we print.</p>
        {proofs}
      </Notice>
    );
  return (
    <Notice title="We can't print this book" status={flow.status}>
      <p>{flow.reviewNote ?? "Our team couldn't approve it."} Reply to our email with any questions.</p>
      {proofs}
    </Notice>
  );
}

/** Where a book is, from the photos to print, with the current stage marked. */
const stages = ["Photos and characters", "Drawing", "Read and approve", "Our review", "Print"] as const;
const stageOf: Record<Flow["status"], number> = {
  draft: 0,
  ordered: 1,
  making: 1,
  changes: 2,
  in_review: 3,
  refused: 3,
  approved: 4,
};

function BookProgress({ status }: { status: Flow["status"] }) {
  const current = stageOf[status];
  return (
    <ol className="flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label="Where your book is" data-testid="book-progress">
      {stages.map((stage, i) => {
        const done = i < current || status === "approved";
        return (
          <li
            key={stage}
            aria-current={i === current ? "step" : undefined}
            className={cn(
              "flex items-center gap-1",
              i === current ? "font-semibold text-foreground" : done ? "text-foreground" : "text-muted-foreground",
              i === current && status === "refused" && "text-destructive",
            )}
          >
            <span aria-hidden>{done ? "✓" : `${i + 1}.`}</span>
            {stage}
          </li>
        );
      })}
    </ol>
  );
}

/** The book's proofs from the server, for any member: listing, and for owners and editors making and approving. */
function BookProofs({
  view,
  canEdit,
  onProofs,
}: {
  view: BookView;
  canEdit: boolean;
  onProofs?: (list: ProofList) => void;
}) {
  const bookId = view.book.id;
  // Reloads the list when the book changes (a page chosen, text saved), so each proof says whether it's current.
  const stamp = JSON.stringify([view.cast, view.pages, view.flow.pages.map((page) => page.chosenVersion)]);
  const load = useCallback(
    async () => unwrapResult(BookProofsResult)(await listBookProofsFn({ data: { bookId } })),
    [bookId],
  );
  return (
    <ProofPanel
      embedded
      hydrated
      load={load}
      reloadKey={stamp}
      request={async () => {
        unwrapResult(RequestBookProofResult)(await requestBookProofFn({ data: { bookId } }));
      }}
      approve={async (proofId) => {
        unwrapResult(ApproveProofResult)(await approveProofFn({ data: { proofId } }));
      }}
      remove={async (proofId) => {
        unwrapResult(DeleteProofResult)(await deleteProofFn({ data: { proofId } }));
      }}
      onProofs={canEdit ? onProofs : undefined}
    />
  );
}

/** Scrolls to the book's pages, showing page `pageId` if given. */
export const EDITOR_ID = "book-pages";
export const FINISH_ID = "finish-book";

function Notice({ title, status, children }: { title: string; status?: Flow["status"]; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-md border bg-muted/40 p-4 text-sm" data-testid="book-step">
      {status && <BookProgress status={status} />}
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

/**
 * The look's attributes as the confirmation shows them: each option with its swatch or its description (hair length
 * and texture), if it has one.
 */
const yesNo = [
  { id: true, label: "Yes" },
  { id: false, label: "No" },
] as const;
const lookFields: ReadonlyArray<{
  key: LookKey;
  label: string;
  options: ReadonlyArray<{ id: string | boolean; label: string; swatch?: string; description?: string }>;
}> = [
  { key: "hairColour", label: "Hair colour", options: hairColours },
  { key: "hairLength", label: "Hair length", options: hairLengths },
  { key: "hairTexture", label: "Hair texture", options: hairTextures },
  { key: "eyeColour", label: "Eyes", options: eyeColours },
  { key: "skinTone", label: "Skin tone", options: skinTones },
  { key: "freckles", label: "Freckles", options: yesNo },
  { key: "glasses", label: "Glasses", options: yesNo },
];
const optionLabel = (options: (typeof lookFields)[number]["options"], id: string | boolean | null | undefined) =>
  options.find((option) => option.id === id)?.label ?? "Not sure";

/**
 * How a person looks (D56): what the photo showed, which the parent confirms or corrects before the first drawing.
 * Each attribute says where it came from; where the parent's choice differs from the photo, both show.
 */
function LookConfirm({ view, slotId, name }: { view: BookView; slotId: string; name: string }) {
  const likeness = view.flow.likenesses.find((candidate) => candidate.slotId === slotId)!;
  const choices: LookChoices = view.roles.find((candidate) => candidate.slotId === slotId)?.person.look ?? {};
  const photo = likeness.check?.report ?? null;
  const look = lookOf(photo, choices);
  const locked = likeness.drawing || likeness.sheetKey !== null;
  const { error, pending, run } = useStep();
  const set = (key: LookKey, value: string) => {
    const next: Record<string, unknown> = { ...choices };
    const option = lookFields.find((field) => field.key === key)!.options.find((o) => String(o.id) === value);
    if (!option) delete next[key];
    else next[key] = option.id;
    void run(() => setLookFn({ data: { bookId: view.book.id, slotId, look: next as LookChoices } }));
  };
  return (
    <div className="@container flex flex-col gap-2" data-testid={`look-${slotId}`}>
      <p className="text-xs text-muted-foreground">
        {locked
          ? `How we drew ${name}. To change it, write a note under their sheet.`
          : `How ${name} looks, from the photo. Fix anything that's wrong before you draw them: it goes along with the photo.`}
      </p>
      {/* Two columns by the card's width, not the window's: from 768 px two cards share the row. */}
      <dl className="grid grid-cols-1 gap-x-3 gap-y-2 @[22rem]:grid-cols-2">
        {lookFields.map((field) => {
          const chosen = choices[field.key] !== undefined;
          const fromPhoto = photo?.[field.key] ?? null;
          const value = look[field.key];
          const selected = field.options.find((option) => option.id === value);
          const swatch = selected?.swatch;
          const described = field.options.some((option) => option.description);
          const descriptionId = `look-${slotId}-${field.key}-description`;
          return (
            <div key={field.key} className="flex flex-col gap-0.5 text-xs">
              <dt className="flex items-center justify-between gap-2 font-medium">
                {field.label}
                <span className={cn("font-normal", chosen ? "text-primary" : "text-muted-foreground")}>
                  {chosen ? "You set this" : fromPhoto === null ? "Not in the photo" : "From the photo"}
                </span>
              </dt>
              <dd className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-4 shrink-0 rounded-full ring-1 ring-black/20"
                  style={{ background: swatch ?? "transparent" }}
                />
                <NativeSelect
                  aria-label={`${name}'s ${field.label.toLowerCase()}`}
                  aria-describedby={selected?.description ? descriptionId : undefined}
                  className="h-8 min-w-0 flex-1 text-xs"
                  value={value === null ? "" : String(value)}
                  disabled={locked || pending}
                  onChange={(event) => set(field.key, event.target.value)}
                >
                  <option value="">{fromPhoto === null ? "Not sure" : "As in the photo"}</option>
                  {field.options.map((option) => (
                    <option key={String(option.id)} value={String(option.id)}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              </dd>
              {selected?.description && (
                <dd id={descriptionId} className="text-muted-foreground" data-testid={descriptionId}>
                  {selected.description}
                </dd>
              )}
              {described && (
                <dd>
                  <details className="text-muted-foreground">
                    <summary className="cursor-pointer underline-offset-2 hover:underline">
                      What each {field.label.toLowerCase()} means
                    </summary>
                    <dl className="mt-1 flex flex-col gap-1.5 border-l-2 pl-2 leading-snug">
                      {field.options.map((option) => (
                        <div key={String(option.id)}>
                          <dt className="inline font-medium text-foreground">{option.label}:</dt>{" "}
                          <dd className="inline">{option.description}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                </dd>
              )}
              {chosen && fromPhoto !== null && fromPhoto !== value && (
                <dd className="text-amber-700">
                  The photo looked {optionLabel(field.options, fromPhoto).toLowerCase()}.
                </dd>
              )}
            </div>
          );
        })}
      </dl>
      <Alert text={error} />
    </div>
  );
}

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

/**
 * One photo's upload, for the main photo or an extra pose (D56): the chosen or dropped file is resized and sent.
 * Each slot holds one photo, so a drop of several files, or of a non-photo, uploads nothing and says why.
 */
function usePhotoUpload(view: BookView, slotId: string, name: string, pose?: PhotoPose) {
  const router = useRouter();
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
      if (pose) form.set("pose", pose);
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

  const drop = (files: ReadonlyArray<File>) => {
    if (uploading) return setError(`Wait for ${name}'s photo to finish uploading.`);
    if (files.length !== 1)
      return setError(`That's ${files.length} files. Drop one photo here: each slot takes one photo of ${name}.`);
    if (!isPhotoFile(files[0]!)) return setError("That isn't a photo we can use. Drop a JPEG, PNG, WebP or HEIC.");
    void upload(files[0]!);
  };

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (file) void upload(file);
  };

  /** Makes an element this slot's drop target. */
  const dropTarget = {
    onDragOver: (event: React.DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      setDragging(true);
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (event: React.DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setDragging(false);
      drop([...event.dataTransfer.files]);
    },
  };
  return { error, uploading, dragging, pick, dropTarget };
}

const checkText = (uploading: boolean, status: string | null) =>
  uploading
    ? "Uploading…"
    : status === "checking"
      ? "Checking the photo…"
      : status === "passed"
        ? "This photo works."
        : status === "refused"
          ? "We can't use this photo."
          : "No photo yet.";

/** An extra photo's slot (D56): optional, one photo, with its own buttons and drop target. */
function PoseSlot({ view, slotId, name, pose }: { view: BookView; slotId: string; name: string; pose: PhotoPose }) {
  const info = photoPoses.find((candidate) => candidate.id === pose)!;
  const likeness = view.flow.likenesses.find((candidate) => candidate.slotId === slotId)!;
  const photo = likeness.poses.find((candidate) => candidate.pose === pose);
  const { error, uploading, dragging, pick, dropTarget } = usePhotoUpload(view, slotId, name, pose);
  const busy = uploading || likeness.drawing;
  return (
    <li
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded border p-2 text-xs",
        dragging && "border-dashed border-primary bg-accent",
      )}
      data-testid={`pose-${slotId}-${pose}`}
      {...dropTarget}
    >
      {/* The buttons sit beside the label when the card has room and wrap below it when it doesn't. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 grow basis-48 flex-col gap-0.5">
          <p className="font-medium">{info.label}</p>
          <p className="text-muted-foreground">{info.hint}</p>
          {(uploading || photo) && (
            <p data-testid={`pose-status-${slotId}-${pose}`}>{checkText(uploading, photo?.checkStatus ?? null)}</p>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {photo?.photoKey && (
            <img src={fileUrl(photo.photoKey)} alt={`${name}: ${info.label.toLowerCase()}`} className="h-12 rounded" />
          )}
          <FileInput
            label=""
            aria-label={`${info.label} (${name})`}
            buttonText={photo?.photoKey ? "Choose another" : "Choose a photo"}
            emptyText=""
            accept={photoTypes.join(",")}
            disabled={busy}
            onChange={pick}
          />
          <FileInput
            className="hidden pointer-coarse:flex"
            label=""
            icon={<CameraIcon />}
            aria-label={`Use the camera for ${name}, ${info.label.toLowerCase()}`}
            buttonText="Take a photo"
            emptyText=""
            accept="image/*"
            capture="environment"
            disabled={busy}
            onChange={pick}
          />
        </div>
      </div>
      {photo?.check?.refusals.map((issue) => (
        <p key={issue.code} className="text-destructive">
          {issue.message}
        </p>
      ))}
      <Alert text={error} />
    </li>
  );
}

function PhotoCard({ view, slotId }: { view: BookView; slotId: string }) {
  const slot = view.manifest.characterSlots.find((candidate) => candidate.slotId === slotId)!;
  const role = view.roles.find((candidate) => candidate.slotId === slotId);
  const likeness = view.flow.likenesses.find((candidate) => candidate.slotId === slotId)!;
  const name = role?.person.name ?? slot.label;
  const { error, uploading, dragging, pick, dropTarget } = usePhotoUpload(view, slotId, name);

  const check = likeness.check;
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-md border p-3 text-sm",
        dragging && "border-dashed border-primary bg-accent",
      )}
      data-testid={`photo-${slotId}`}
      {...dropTarget}
    >
      <p className="font-medium">
        {slot.label}: {role?.person.name}
      </p>
      <FileInput
        label={`Photo of ${role?.person.name ?? slot.label}`}
        buttonText={likeness.photoKey ? "Choose another photo" : "Choose a photo"}
        emptyText={likeness.photoKey ? "Photo added" : undefined}
        accept={photoTypes.join(",")}
        disabled={uploading}
        onChange={pick}
      />
      {/* Phones: a plain picker doesn't offer the camera on Android 14+ Chrome, so the camera gets its own button. */}
      <FileInput
        className="hidden pointer-coarse:flex"
        label="Or use the camera"
        icon={<CameraIcon />}
        aria-label={`Take ${name}'s photo with the camera`}
        buttonText={likeness.photoKey ? "Take another photo" : "Take a photo"}
        emptyText=""
        accept="image/*"
        capture="environment"
        disabled={uploading}
        onChange={pick}
      />
      <p className="text-xs text-muted-foreground pointer-coarse:hidden">
        {dragging ? `Drop the photo of ${name}` : "Or drag a photo onto this card."}
      </p>
      {likeness.photoKey && (
        <img src={fileUrl(likeness.photoKey)} alt={`Photo of ${role?.person.name}`} className="h-28 w-fit rounded" />
      )}
      <p data-testid={`photo-status-${slotId}`} className="text-xs">
        {checkText(uploading, likeness.checkStatus)}
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
      {likeness.checkStatus === "passed" && (
        <>
          <p className="text-xs text-muted-foreground">
            More photos help us draw {name} from every side. They're optional; we recommend at least one.
          </p>
          <ul className="flex flex-col gap-2" aria-label={`More photos of ${name}`}>
            {photoPoses.map((pose) => (
              <PoseSlot key={pose.id} view={view} slotId={slotId} name={name} pose={pose.id} />
            ))}
          </ul>
          <LookConfirm view={view} slotId={slotId} name={name} />
        </>
      )}
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
  const order = useStep();
  if (!flow.likenesses.some((likeness) => likeness.checkStatus === "passed" || likeness.sheetKey)) return null;
  const coverIndex = flow.cover ? manifest.pages.findIndex((page) => page.pageId === flow.cover!.pageId) : -1;
  const ready = flow.likenessStatus === "ready";
  return (
    <section className="flex flex-col gap-3" aria-labelledby="preview-heading" data-testid="book-step">
      <h2 id="preview-heading" className="text-base font-semibold">
        Your characters
      </h2>
      <p className="text-sm text-muted-foreground">
        Draw each person once their photo is right. You get {MAX_SHEET_DRAWS} drawings of each person: the first, then a
        note on their sheet or a new photo uses one.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {manifest.characterSlots.map((slot) => (
          <SheetCard key={slot.slotId} view={view} slotId={slot.slotId} />
        ))}
      </div>
      {flow.likenessStatus === "drawing" && flow.likenesses.every((likeness) => !likeness.drawing) && (
        <p className="text-sm">Drawing the cover with everyone on it…</p>
      )}
      {flow.likenessStatus === "failed" && (
        <p role="alert" className="text-sm text-destructive">
          We couldn't finish that drawing; it didn't use one of your drawings. Try again, or reply to any of our emails
          and we'll look into it.
        </p>
      )}
      {ready && flow.cover && coverIndex >= 0 && (
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
      {ready && (
        <>
          <Button
            className="w-fit"
            disabled={order.pending}
            onClick={() => order.run(() => orderBookFn({ data: { bookId: view.book.id } }))}
          >
            Make my book
          </Button>
          <p className="text-xs text-muted-foreground">
            "Make my book" places your order: we draw every page from these characters and delete the photos
            {flow.photoReview ? " once our team has reviewed the book" : ""}. You can then change up to{" "}
            {MAX_PAGE_CHANGES} pages. <Policies />
          </p>
        </>
      )}
      <Alert text={order.error} />
    </section>
  );
}

/** One person's sheet: "Draw {name}" when there's none, else the sheet and a note for another drawing. */
function SheetCard({ view, slotId }: { view: BookView; slotId: string }) {
  const slot = view.manifest.characterSlots.find((candidate) => candidate.slotId === slotId)!;
  const name = view.roles.find((candidate) => candidate.slotId === slotId)?.person.name ?? slot.label;
  const likeness = view.flow.likenesses.find((candidate) => candidate.slotId === slotId)!;
  const [note, setNote] = useState("");
  const { error, pending, run } = useStep();
  const left = MAX_SHEET_DRAWS - likeness.draws;
  const drawingsLeft = `${left} ${left === 1 ? "drawing" : "drawings"} left`;
  return (
    <figure className="flex flex-col gap-2 rounded-md border p-3 text-sm" data-testid={`sheet-card-${slotId}`}>
      {likeness.sheetKey && (
        <img
          src={fileUrl(likeness.sheetKey)}
          alt={`${name}'s character sheet`}
          className="w-full rounded"
          data-testid={`sheet-${slotId}`}
        />
      )}
      {likeness.expressionsKey && (
        <img
          src={fileUrl(likeness.expressionsKey)}
          alt={`${name} in six expressions`}
          className="w-full rounded"
          data-testid={`expressions-${slotId}`}
        />
      )}
      <figcaption className="font-medium">{name}</figcaption>
      {likeness.drawing ? (
        <p>Drawing {name}: about 20 seconds.</p>
      ) : likeness.checkStatus !== "passed" || !likeness.photoKey ? (
        !likeness.sheetKey && <p className="text-muted-foreground">Add a photo of {name} that passes the check.</p>
      ) : left <= 0 ? (
        <p className="text-muted-foreground">That was the last drawing of {name}.</p>
      ) : !likeness.sheetKey ? (
        <Button
          className="w-fit"
          disabled={pending}
          onClick={() => run(() => drawSheetFn({ data: { bookId: view.book.id, slotId } }))}
        >
          Draw {name} ({drawingsLeft})
        </Button>
      ) : (
        <>
          <textarea
            aria-label={`What to change about ${name}`}
            placeholder="Anything to change? For example: curlier hair, freckles."
            className="min-h-16 rounded-md border bg-transparent p-2 text-sm"
            value={note}
            maxLength={300}
            onChange={(event) => setNote(event.target.value)}
          />
          <Button
            variant="outline"
            className="w-fit"
            disabled={pending || note.trim() === ""}
            onClick={async () => {
              if (await run(() => drawSheetFn({ data: { bookId: view.book.id, slotId, note } }))) setNote("");
            }}
          >
            Redraw {name} with this note ({drawingsLeft})
          </Button>
        </>
      )}
      <Alert text={error} />
    </figure>
  );
}

type StepState = "done" | "current" | "waiting" | "todo";

function Step({
  n,
  title,
  state,
  testId,
  children,
}: {
  n: number;
  title: string;
  state: StepState;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <li
      className={cn(
        "flex min-w-0 gap-3 rounded-md border p-3",
        state === "current" && "border-foreground/40 bg-background shadow-sm",
        state === "waiting" && "border-dashed border-amber-500/70 bg-background",
      )}
      data-testid={testId}
      data-state={state}
      aria-current={state === "current" ? "step" : undefined}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
          state === "done"
            ? "bg-emerald-600 text-white"
            : state === "current"
              ? "bg-foreground text-background"
              : state === "waiting"
                ? "animate-pulse bg-amber-100 text-amber-900"
                : "border",
        )}
      >
        {state === "done" ? "✓" : state === "waiting" ? "…" : n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="font-medium">
          {title}
          <span className="sr-only">
            {state === "done"
              ? " (done)"
              : state === "current"
                ? " (next)"
                : state === "waiting"
                  ? " (in progress)"
                  : ""}
          </span>
        </h3>
        {children}
      </div>
    </li>
  );
}

/**
 * The drawn book's last steps for the parent (D57), in the order they're done: read the pages (changing up to three
 * drawings and any text), make a proof and approve it, then send the book to our review. Each step says what's left
 * and what's still being drawn or made; the pages themselves are the editor below.
 */
function FinishBook({ view, canEdit }: { view: BookView; canEdit: boolean }) {
  const { flow, manifest } = view;
  const navigate = useNavigate();
  const { error, pending, run } = useStep();
  const [list, setList] = useState<ProofList | null>(null);
  const used = flow.pages.filter((page) => page.latestVersion > 1).length;
  const redrawing = flow.pages.filter((page) => !page.ready);
  const changed = flow.pages.filter((page) => page.latestVersion > 1);
  const proofs = list?.proofs ?? [];
  const approved = proofs.filter((proof) => proof.approvedAt);
  const approvedNow = approved.some((proof) => proof.current);
  const making = proofs.some((proof) => proof.current && proof.status === "rendering");
  const readyToApprove = proofs.some((proof) => proof.current && proof.status === "ready" && !proof.approvedAt);
  const pageNumber = (pageId: string) => manifest.pages.findIndex((page) => page.pageId === pageId) + 1;
  const showPage = (pageId?: string) => {
    void navigate({
      to: "/books/$bookId",
      params: { bookId: view.book.id },
      search: pageId ? { page: pageId } : {},
      replace: true,
      resetScroll: false,
    }).then(() => document.getElementById(EDITOR_ID)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const onProofs = useCallback((next: ProofList) => setList(next), []);

  const pagesState: StepState = redrawing.length > 0 ? "waiting" : proofs.length > 0 ? "done" : "current";
  // One step is current at a time: reading until there's a proof, then the proof until it's approved, then sending.
  const proofState: StepState = approvedNow
    ? "done"
    : making
      ? "waiting"
      : redrawing.length > 0 || proofs.length === 0
        ? "todo"
        : "current";
  const sendState: StepState = approvedNow && redrawing.length === 0 ? "current" : "todo";
  const blocked =
    redrawing.length > 0
      ? `Wait for page ${redrawing.map((page) => pageNumber(page.pageId)).join(", ")} to finish redrawing.`
      : approved.length === 0
        ? "Approve a proof first: it's the file we review and print."
        : null;

  return (
    <section
      id={FINISH_ID}
      className="flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-md border bg-muted/40 p-4 text-sm"
      aria-labelledby="finish-heading"
      data-testid="book-step"
    >
      <BookProgress status={flow.status} />
      <h2 id="finish-heading" className="text-base font-semibold">
        Read your book
      </h2>
      <p className="text-muted-foreground">
        Every page is drawn. Three steps before we print it: read the pages, approve a proof, then send it to us.
        {!canEdit && " Someone in your family who edits books does these."}
      </p>
      <ol className="grid gap-2 lg:grid-cols-3" aria-label="Steps to finish your book">
        <Step n={1} title="Read every page" state={pagesState} testId="finish-pages">
          <p>
            Read the pages below and fix any text. You can change the drawing on up to {MAX_PAGE_CHANGES} pages (
            {MAX_PAGE_CHANGES - used} left).
          </p>
          {redrawing.length > 0 && (
            <p data-testid="finish-redrawing">
              Redrawing page {redrawing.map((page) => pageNumber(page.pageId)).join(", ")}: about 20 seconds. You can
              keep reading meanwhile.
            </p>
          )}
          {changed.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Pages you changed">
              {changed.map((page) => (
                <li key={page.pageId}>
                  <Button size="sm" variant="outline" onClick={() => showPage(page.pageId)}>
                    Page {pageNumber(page.pageId)}:{" "}
                    {!page.ready ? "redrawing" : page.chosenVersion === 1 ? "original kept" : "new drawing"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Button
            size="sm"
            variant={pagesState === "current" ? "default" : "outline"}
            className="w-fit"
            onClick={() => showPage()}
          >
            Read the pages
          </Button>
        </Step>
        <Step n={2} title="Make a proof and approve it" state={proofState} testId="finish-proof">
          <p>
            The proof is the PDF we print, with your characters and text as they are now. Download it, check every page,
            then approve it.
          </p>
          {approved.length > 0 && !approvedNow && (
            <p className="text-amber-700" data-testid="finish-proof-outdated">
              You changed the book after approving a proof. Make a new proof and approve it, so we review and print the
              book as it is now.
            </p>
          )}
          {readyToApprove && <p className="font-medium">Your proof is ready: download it and check it.</p>}
          <BookProofs view={view} canEdit={canEdit} onProofs={onProofs} />
        </Step>
        <Step n={3} title="Send it to us for review" state={sendState} testId="finish-send">
          <p>
            Our team checks every page before anything is printed, and emails you if something needs changing. After you
            send it, the pages and proof can't change.
          </p>
          {canEdit && (
            <>
              {blocked && list && <p className="text-muted-foreground">{blocked}</p>}
              {!blocked && !approvedNow && (
                <p className="text-amber-700">
                  Sending now sends your older approved proof, without your latest changes.
                </p>
              )}
              <Button
                className="w-fit"
                disabled={pending || blocked !== null || !list}
                onClick={() => run(() => sendForReviewFn({ data: { bookId: view.book.id } }))}
              >
                Send for review
              </Button>
            </>
          )}
        </Step>
      </ol>
      <PhotoReviewNote view={view} canEdit={canEdit} />
      <Alert text={error} />
    </section>
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
