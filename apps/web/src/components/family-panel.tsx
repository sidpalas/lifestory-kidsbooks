// The active family: its name (owners can rename it), its members and pending invitations,
// and (for owners and parents) a form to invite someone as a parent or a viewer.
import { FAMILY_NAME_MAX_LENGTH, type FamilyOverview, unwrapResult } from "@lifestory/core/contracts";
import { useHydrated, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { NativeSelect } from "~/components/ui/native-select";
import {
  inviteFamilyFn,
  InviteFamilyResult,
  inviteMemberFn,
  InviteMemberResult,
  renameFamilyFn,
  RenameFamilyResult,
} from "~/server/families";

const roleLabel: Record<string, string> = { owner: "Owner", parent: "Parent", viewer: "Viewer (read only)" };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function FamilyPanel({ family }: { family: FamilyOverview }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const stopRenaming = () => {
    setRenaming(false);
    setRenameError(null);
  };

  const rename = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name")).trim();
    if (name.length === 0) return setRenameError("The family needs a name.");
    try {
      unwrapResult(RenameFamilyResult)(await renameFamilyFn({ data: { familyId: family.id, name } }));
      stopRenaming();
      await router.invalidate();
    } catch (error) {
      setRenameError(message(error));
    }
  };

  const invite = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const role = form.get("role") === "parent" ? "parent" : "viewer";
    try {
      const { email } = unwrapResult(InviteMemberResult)(
        await inviteMemberFn({ data: { familyId: family.id, email: String(form.get("email")), role } }),
      );
      setStatus({ ok: true, text: `Invitation sent to ${email}.` });
      formElement.reset();
      await router.invalidate();
    } catch (error) {
      setStatus({ ok: false, text: message(error) });
    }
  };

  return (
    <Card data-testid="family-panel">
      <CardHeader className="px-4 sm:px-6">
        {renaming ? (
          <form className="flex flex-col gap-2" onSubmit={rename} aria-label="Rename the family">
            <Label htmlFor="family-rename">Family name</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="family-rename"
                name="name"
                className="sm:flex-1"
                defaultValue={family.name}
                maxLength={FAMILY_NAME_MAX_LENGTH}
                required
                autoFocus
              />
              <div className="flex gap-2">
                <Button type="submit" disabled={!hydrated}>
                  Save
                </Button>
                <Button type="button" variant="outline" onClick={stopRenaming}>
                  Cancel
                </Button>
              </div>
            </div>
            {renameError && (
              <p className="text-destructive text-sm" role="alert">
                {renameError}
              </p>
            )}
          </form>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <CardTitle data-testid="family-name" className="min-w-0 text-xl leading-snug wrap-anywhere">
              {family.name}
            </CardTitle>
            {family.canRename && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setRenaming(true)}
                disabled={!hydrated}
              >
                Rename
              </Button>
            )}
          </div>
        )}
        <CardDescription>
          You're{" "}
          {family.role === "viewer" ? "a viewer: you can read this family's books" : `the family's ${family.role}`}.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 px-4 sm:px-6">
        <section className="flex flex-col gap-2" aria-labelledby="family-members">
          <h2 id="family-members" className="text-sm font-semibold">
            Members <span className="text-muted-foreground font-normal">· {family.members.length}</span>
          </h2>
          <ul className="divide-y rounded-lg border" data-testid="members">
            {family.members.map((member) => {
              // Accounts created from an email alone have the email as their name: show it once.
              const named =
                member.name.trim() !== "" && member.name.trim().toLowerCase() !== member.email.toLowerCase();
              return (
                <MemberRow
                  key={member.userId}
                  testId="member"
                  primary={named ? member.name : member.email}
                  secondary={named ? member.email : null}
                  role={member.role}
                />
              );
            })}
          </ul>
        </section>
        {family.invitations.length > 0 && (
          <section className="flex flex-col gap-2" aria-labelledby="family-invitations">
            <h2 id="family-invitations" className="text-sm font-semibold">
              Pending invitations{" "}
              <span className="text-muted-foreground font-normal">· {family.invitations.length}</span>
            </h2>
            <ul className="divide-y rounded-lg border border-dashed" data-testid="invitations">
              {family.invitations.map((invitation) => (
                <MemberRow
                  key={invitation.id}
                  testId="invitation"
                  primary={invitation.email}
                  secondary="Invitation pending"
                  role={invitation.role}
                  pending
                />
              ))}
            </ul>
          </section>
        )}
        {family.canInvite && (
          <section className="flex flex-col gap-3 border-t pt-6" aria-labelledby="family-invite">
            <div className="flex flex-col gap-1">
              <h2 id="family-invite" className="text-sm font-semibold">
                Invite someone
              </h2>
              <p className="text-muted-foreground text-sm">
                Parents can make and edit books. Viewers can only read them.
              </p>
            </div>
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={invite}
              aria-label="Invite a family member"
            >
              <div className="flex min-w-0 flex-col gap-2 sm:flex-1">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  name="email"
                  type="email"
                  autoComplete="off"
                  placeholder="name@example.com"
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="invite-role">Role</Label>
                <NativeSelect id="invite-role" name="role" defaultValue="viewer" className="w-full">
                  <option value="viewer">Viewer (read only)</option>
                  <option value="parent">Parent (can edit)</option>
                </NativeSelect>
              </div>
              <Button type="submit" className="w-full sm:w-auto" disabled={!hydrated}>
                Send invitation
              </Button>
            </form>
            {status && (
              <p className={status.ok ? "text-sm" : "text-destructive text-sm"} role="status">
                {status.text}
              </p>
            )}
          </section>
        )}
      </CardContent>
    </Card>
  );
}

/** One member or invitation: who (name over email, or the email alone) and their role. The role wraps under the
 * identity when the row is too narrow for both, instead of squeezing either. */
function MemberRow({
  testId,
  primary,
  secondary,
  role,
  pending = false,
}: {
  testId: string;
  primary: string;
  secondary: string | null;
  role: string;
  pending?: boolean;
}) {
  return (
    <li
      data-testid={testId}
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-3 py-3 sm:px-4"
    >
      <div className="flex min-w-0 flex-[1_1_16rem] flex-col">
        <span className="text-sm font-medium wrap-anywhere">{primary}</span>
        {secondary && <span className="text-muted-foreground text-sm wrap-anywhere">{secondary}</span>}
      </div>
      <span
        className={
          pending
            ? "text-muted-foreground rounded-full border border-dashed px-2.5 py-0.5 text-xs font-medium whitespace-nowrap"
            : "bg-secondary text-secondary-foreground rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap"
        }
      >
        {roleLabel[role] ?? role}
      </span>
    </li>
  );
}

/** The operator invites a new family: the account and its family are created now. */
export function InviteFamilyCard() {
  const hydrated = useHydrated();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const { email } = unwrapResult(InviteFamilyResult)(
        await inviteFamilyFn({ data: { name: String(form.get("name")), email: String(form.get("email")) } }),
      );
      setStatus({ ok: true, text: `Invitation sent to ${email}. They choose a password from the emailed link.` });
      formElement.reset();
    } catch (error) {
      setStatus({ ok: false, text: message(error) });
    }
  };

  return (
    <Card data-testid="invite-family">
      <CardHeader>
        <CardTitle>Invite a new family</CardTitle>
        <CardDescription>
          Operator only. Creates the account and its family; the invitee sets a password from the email.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form className="flex flex-wrap items-end gap-2" onSubmit={submit} aria-label="Invite a new family">
          <div className="flex min-w-40 flex-1 flex-col gap-2">
            <Label htmlFor="family-name">Name</Label>
            <Input id="family-name" name="name" required />
          </div>
          <div className="flex min-w-48 flex-1 flex-col gap-2">
            <Label htmlFor="family-email">Email</Label>
            <Input id="family-email" name="email" type="email" required />
          </div>
          <Button type="submit" disabled={!hydrated}>
            Invite family
          </Button>
        </form>
        {status && (
          <p className={status.ok ? "text-sm" : "text-destructive text-sm"} role="status">
            {status.text}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
