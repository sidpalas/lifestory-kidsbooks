// The app shell around every family page (D48): a sidebar on wide screens with the family's places and, for authors
// and the operator, a separate Studio link (and Admin for the operator); on phones a top bar and bottom tabs instead. Story and book pages open
// without it, full width, so their pages have room.
import { type FamilyMembership, unwrapResult } from "@lifestory/core/contracts";
import { Link, useHydrated, useRouter } from "@tanstack/react-router";
import type * as React from "react";

import { Button } from "~/components/ui/button";
import { NativeSelect } from "~/components/ui/native-select";
import { signOut, SignOutResult } from "~/server/accounts";
import { switchFamilyFn, SwitchFamilyResult } from "~/server/families";

export type Shell = {
  user: { name: string; email: string };
  families: ReadonlyArray<FamilyMembership>;
  active: FamilyMembership | null;
  canAuthor: boolean;
  isOperator: boolean;
};

const places = (viewer: boolean) =>
  [
    { to: "/", label: "Home", short: "Home" },
    { to: "/stories", label: "Stories", short: "Stories" },
    { to: "/books", label: "Our books", short: "Books" },
    { to: "/characters", label: "Characters", short: "Characters" },
    { to: "/family", label: viewer ? "Family" : "Family settings", short: "Family" },
  ] as const;

function FamilySwitcher({ shell, id }: { shell: Shell; id?: string }) {
  const router = useRouter();
  // The server-rendered select does nothing until React hydrates, so keep it disabled until then.
  const hydrated = useHydrated();
  const switchTo = async (familyId: string) => {
    unwrapResult(SwitchFamilyResult)(await switchFamilyFn({ data: { familyId } }));
    await router.invalidate();
  };
  // The switcher appears once someone is in more than one family (D3: say little about families until then).
  if (shell.families.length > 1)
    return (
      <NativeSelect
        aria-label="Family"
        className="w-full min-w-0"
        value={shell.active?.id}
        disabled={!hydrated}
        onChange={(event) => void switchTo(event.target.value)}
      >
        {shell.families.map((family) => (
          <option key={family.id} value={family.id}>
            {family.name}
          </option>
        ))}
      </NativeSelect>
    );
  return (
    <p className="truncate text-sm font-medium" data-testid={id}>
      {shell.active?.name ?? "Not in a family yet"}
    </p>
  );
}

function useSignOut() {
  const router = useRouter();
  return async () => {
    unwrapResult(SignOutResult)(await signOut());
    await router.navigate({ to: "/sign-in" });
  };
}

export function AppShell({ shell, children }: { shell: Shell; children: React.ReactNode }) {
  const hydrated = useHydrated();
  const leave = useSignOut();
  const viewer = shell.active?.role === "viewer";
  const studio = shell.canAuthor || shell.isOperator;
  const navItem = "rounded-md px-3 py-1.5 text-sm hover:bg-accent";
  return (
    <div className="flex min-h-screen">
      <aside
        className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col gap-1 border-r bg-secondary/40 p-4 md:flex"
        aria-label="Lifestory"
      >
        <Link to="/" className="px-3 pb-3 text-lg font-semibold">
          Lifestory
        </Link>
        <div className="flex flex-col gap-1 px-3 pb-3">
          <FamilySwitcher shell={shell} id="families" />
          {viewer && <p className="text-xs text-muted-foreground">Viewer: you can read this family's books</p>}
        </div>
        <nav aria-label="Family" className="flex flex-col gap-0.5">
          {places(viewer).map((place) => (
            <Link
              key={place.to}
              to={place.to}
              className={navItem}
              activeOptions={{ exact: place.to === "/" }}
              activeProps={{ className: "bg-accent font-semibold" }}
            >
              {place.label}
            </Link>
          ))}
        </nav>
        {studio && (
          <div className="mt-3 flex flex-col gap-1 border-t pt-3">
            <p className="px-3 text-xs text-muted-foreground">
              {shell.isOperator ? "Behind the scenes" : "For authors"}
            </p>
            <Link
              to="/author"
              className="rounded-md border border-primary/40 px-3 py-1.5 text-sm font-medium text-primary hover:bg-accent"
            >
              Studio
            </Link>
            {shell.isOperator && (
              <Link to="/admin" className={navItem} activeProps={{ className: "bg-accent font-semibold" }}>
                Admin
              </Link>
            )}
          </div>
        )}
        <div className="mt-auto flex flex-col items-start gap-1 px-3 text-xs">
          <p className="break-all text-muted-foreground" data-testid="signed-in-as">
            Signed in as {shell.user.name} ({shell.user.email})
          </p>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() => void leave()}
            disabled={!hydrated}
          >
            Sign out
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background px-4 py-2 md:hidden">
          <Link to="/" className="font-semibold">
            Lifestory
          </Link>
          <div className="min-w-0 flex-1">
            <FamilySwitcher shell={shell} />
          </div>
          {studio && (
            <Link
              to="/author"
              className="rounded-md border border-primary/40 px-2 py-1 text-xs font-medium text-primary"
            >
              Studio
            </Link>
          )}
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() => void leave()}
            disabled={!hydrated}
          >
            Sign out
          </Button>
        </header>
        {children}
      </div>

      <nav
        aria-label="Sections"
        className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t bg-background md:hidden"
      >
        {places(viewer).map((place) => (
          <Link
            key={place.to}
            to={place.to}
            className="py-3 text-center text-xs text-muted-foreground"
            activeOptions={{ exact: place.to === "/" }}
            activeProps={{ className: "text-primary font-semibold" }}
          >
            {place.short}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** A page inside the shell: its heading and content, at a readable width. */
export function ShellPage({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </header>
      {children}
    </main>
  );
}

/** Studio's bar (D48): authoring and the operator's tools, kept apart from the family's pages. */
export function StudioBar() {
  const hydrated = useHydrated();
  const leave = useSignOut();
  return (
    <header className="flex items-center gap-4 bg-[oklch(0.27_0.02_60)] px-4 py-3 text-[oklch(0.93_0.01_85)] sm:px-6">
      <Link to="/author" className="font-semibold">
        Lifestory Studio
      </Link>
      <span className="flex-1" />
      <Link to="/" className="rounded-md border border-[oklch(0.72_0.02_60)] px-3 py-1 text-sm hover:bg-white/10">
        Back to family
      </Link>
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0 text-xs text-[oklch(0.93_0.01_85)]"
        onClick={() => void leave()}
        disabled={!hydrated}
      >
        Sign out
      </Button>
    </header>
  );
}
