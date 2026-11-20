// The landing page's "try it" character picker for signed-out visitors: the real LookPicker, limited to the child
// ages, drawing every portrait by stacking static layers from public/marketing/looks (looks-demo-layers.ts) instead
// of /api/portrait. Nothing leaves the browser: no session, no server function, nothing saved.
// The landing loads this module only when a visitor asks for it.
import { curatedLooks, type Look } from "@lifestory/core/contracts";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { describeLook, LookPicker, type Portrait } from "~/components/look-picker";
import { demoAges, demoLayers } from "~/components/looks-demo-layers";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

const StaticPortrait: Portrait = ({ look, alt, width, height, className, testId }) => (
  <span role={alt ? "img" : undefined} aria-label={alt || undefined} data-testid={testId} className={cn("relative block overflow-hidden", className)} style={{ width, height, aspectRatio: "488 / 560" }}>
    {demoLayers(look).map((layer) => (
      <img key={layer} src={`/marketing/looks/${layer}`} alt="" width={width} height={height} decoding="async" className="absolute inset-0 size-full object-cover" />
    ))}
  </span>
);

export default function LandingLookDemo() {
  const [look, setLook] = useState<Look>(curatedLooks.find((curated) => curated.look.age === "young-child")!.look);
  return (
    <div className="flex flex-col gap-5 rounded-xl border border-dashed p-4 sm:p-6" data-testid="look-demo">
      <p className="text-sm">
        <span className="bg-muted mr-2 rounded px-1.5 py-0.5 text-xs font-medium">Demo</span>
        Nothing here is saved or sent anywhere.
      </p>
      <LookPicker look={look} pronouns="they/them" onChange={setLook} ages={demoAges} portrait={StaticPortrait} />
      <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-sm" data-testid="look-demo-summary">
          In Lifestory you'd give them a name and they'd star in every page: {describeLook(look).toLowerCase()}.
        </p>
        <Button asChild variant="outline" size="sm" className="self-start sm:self-auto">
          <Link to="/sign-in">Sign in to save characters</Link>
        </Button>
      </div>
    </div>
  );
}
