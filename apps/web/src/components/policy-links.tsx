import { Link } from "@tanstack/react-router";

/** Links to the three policies (D58), for footers and the photo and order steps. */
export function PolicyLinks() {
  return (
    <nav aria-label="Policies" className="flex flex-wrap gap-4 border-t pt-4 text-xs text-muted-foreground">
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
