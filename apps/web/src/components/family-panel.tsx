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
import { inviteFamilyFn, InviteFamilyResult, inviteMemberFn, InviteMemberResult, renameFamilyFn, RenameFamilyResult } from "~/server/families";

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
      <CardHeader>
        {renaming ? (
          <form className="flex flex-col gap-2" onSubmit={rename} aria-label="Rename the family">
            <Label htmlFor="family-rename">Family name</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="family-rename"
                name="name"
                className="min-w-48 flex-1"
                defaultValue={family.name}
                maxLength={FAMILY_NAME_MAX_LENGTH}
                required
                autoFocus
              />
              <Button type="submit" disabled={!hydrated}>
                Save
              </Button>
              <Button type="button" variant="outline" onClick={stopRenaming}>
                Cancel
              </Button>
            </div>
            {renameError && (
              <p className="text-destructive text-sm" role="alert">
                {renameError}
              </p>
            )}
          </form>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <CardTitle data-testid="family-name">{family.name}</CardTitle>
            {family.canRename && (
              <Button variant="outline" size="sm" onClick={() => setRenaming(true)} disabled={!hydrated}>
                Rename
              </Button>
            )}
          </div>
        )}
        <CardDescription>
          You're {family.role === "viewer" ? "a viewer: you can read this family's books" : `the family's ${family.role}`}.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col gap-1 text-sm" data-testid="members">
          {family.members.map((member) => (
            <li key={member.userId} className="flex justify-between">
              <span>
                {member.name} <span className="text-muted-foreground">({member.email})</span>
              </span>
              <span>{roleLabel[member.role] ?? member.role}</span>
            </li>
          ))}
          {family.invitations.map((invitation) => (
            <li key={invitation.id} className="text-muted-foreground flex justify-between">
              <span>{invitation.email}</span>
              <span>Invited as {roleLabel[invitation.role] ?? invitation.role}</span>
            </li>
          ))}
        </ul>
        {family.canInvite && (
          <form className="flex flex-wrap items-end gap-2" onSubmit={invite} aria-label="Invite a family member">
            <div className="flex min-w-48 flex-1 flex-col gap-2">
              <Label htmlFor="invite-email">Invite someone by email</Label>
              <Input id="invite-email" name="email" type="email" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-role">Role</Label>
              <NativeSelect id="invite-role" name="role" defaultValue="viewer">
                <option value="viewer">Viewer (read only)</option>
                <option value="parent">Parent (can edit)</option>
              </NativeSelect>
            </div>
            <Button type="submit" disabled={!hydrated}>
              Send invitation
            </Button>
          </form>
        )}
        {status && (
          <p className={status.ok ? "text-sm" : "text-destructive text-sm"} role="status">
            {status.text}
          </p>
        )}
      </CardContent>
    </Card>
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
        <CardDescription>Operator only. Creates the account and its family; the invitee sets a password from the email.</CardDescription>
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
