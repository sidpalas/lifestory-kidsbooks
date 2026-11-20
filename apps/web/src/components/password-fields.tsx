import { MIN_PASSWORD_LENGTH } from "@lifestory/core/contracts";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

/** New password plus confirmation; the form compares them before submitting. */
export function PasswordFields() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
        <p className="text-muted-foreground text-xs">At least {MIN_PASSWORD_LENGTH} characters.</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm">Repeat the password</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </div>
    </>
  );
}
