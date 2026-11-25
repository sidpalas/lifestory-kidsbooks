import { UploadIcon } from "lucide-react";
import { type ComponentProps, type ReactNode, useState } from "react";

import { buttonVariants } from "~/components/ui/button";
import { cn } from "~/lib/utils";

/**
 * A labelled file picker drawn as an outline button with the chosen file's name beside it. The real input stays in
 * the tab order (visually hidden), so the keyboard, screen readers and `setInputFiles` reach it as before.
 */
export function FileInput({
  label,
  buttonText = "Choose file",
  emptyText = "No file chosen",
  icon = <UploadIcon />,
  className,
  onChange,
  ...props
}: Omit<ComponentProps<"input">, "type"> & {
  label: string;
  buttonText?: string;
  emptyText?: string;
  icon?: ReactNode;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <label className={cn("flex min-w-0 flex-col gap-1 text-xs font-medium", className)}>
      {label}
      <span className="relative flex min-w-0 items-center gap-2">
        <input
          type="file"
          aria-label={label}
          className="peer sr-only"
          // Looks like a button, so Enter opens it as well as Space (a native file input only takes Space).
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.currentTarget.click();
          }}
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])];
            if (files.length > 0) setChosen(files.length === 1 ? files[0]!.name : `${files.length} files`);
            onChange?.(event);
          }}
          {...props}
        />
        <span
          aria-hidden
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "cursor-pointer peer-focus-visible:border-ring peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50 peer-disabled:pointer-events-none peer-disabled:opacity-50",
          )}
        >
          {icon}
          {buttonText}
        </span>
        {(chosen ?? emptyText) && (
          <span className="min-w-0 truncate font-normal text-muted-foreground">{chosen ?? emptyText}</span>
        )}
      </span>
    </label>
  );
}
