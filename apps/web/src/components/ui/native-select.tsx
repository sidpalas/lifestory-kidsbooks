import type * as React from "react";
import { cn } from "~/lib/utils";

/** A styled native <select>: accessible and testable without a popover. */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "border-input h-9 rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none disabled:opacity-50",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
