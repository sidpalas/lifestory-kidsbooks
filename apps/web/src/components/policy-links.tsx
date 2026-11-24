import { Link } from "@tanstack/react-router";

import { cn } from "~/lib/utils";

/** Links to the three policies (D58), for footers and the photo and order steps. */
export function PolicyLinks({ className }: { className?: string }) {
  return (
    <nav
      aria-label="Policies"
      className={cn("flex flex-wrap gap-4 border-t pt-4 text-xs text-muted-foreground", className)}
    >
      <Link to="/policies/$policy" params={{ policy: "terms" }} className="underline">
        Terms
      </Link>
      <Link to="/policies/$policy" params={{ policy: "privacy" }} className="underline">
        Privacy
      </Link>
      <Link to="/policies/$policy" params={{ policy: "child-safety" }} className="underline">
        Child safety and AI
      </Link>
    </nav>
  );
}
