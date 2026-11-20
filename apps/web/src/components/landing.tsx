import { Link, useHydrated } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import characterPicker from "~/assets/marketing/character-picker.webp";
import moonPicnic from "~/assets/marketing/moon-picnic.webp";
import paperBoatFamily1 from "~/assets/marketing/paper-boat-family-1.webp";
import paperBoatFamily2 from "~/assets/marketing/paper-boat-family-2.webp";
import socialPreview from "~/assets/marketing/social-preview.png";
import { Button } from "~/components/ui/button";

// The live demo (and the picker it reuses) loads only when a visitor presses "Try it".
const LandingLookDemo = lazy(() => import("~/components/landing-look-demo"));

// The page signed-out visitors see at /. Its images are marketing copies under src/assets/marketing, not story assets:
// those stay behind sign-in. Imported, so the build names each file after its content: a replaced image gets a new
// URL, and browsers and Cloudflare (which keep static images for 4 hours) can't keep showing the old one.

const DESCRIPTION =
  "Picture books written and illustrated by people, starring your family. Pick how each person looks from options the illustrator approved, and every page is drawn with them.";

export const landingHead = ({ url }: { url: string }) => ({
  meta: [
    { title: "Lifestory: picture books starring your family" },
    { name: "description", content: DESCRIPTION },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Lifestory" },
    { property: "og:title", content: "Lifestory: picture books starring your family" },
    { property: "og:description", content: DESCRIPTION },
    { property: "og:url", content: url },
    { property: "og:image", content: new URL(socialPreview, url).href },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: "Two pages of The Paper Boat, the same scene drawn with two different families" },
    { name: "twitter:card", content: "summary_large_image" },
  ],
  links: [{ rel: "canonical", href: url }],
});

const steps = [
  { title: "Pick a story", text: "Each book is written and illustrated by people, with a range of looks for every character." },
  {
    title: "Add your family",
    text: "Choose how each person looks: age, face, skin tone, hairstyle, hair colour, and glasses. No photos needed.",
  },
  { title: "Get your book", text: "Every page is drawn with your family. Tweak the words, then download a print-ready proof." },
];

export function Landing() {
  const [trying, setTrying] = useState(false);
  const hydrated = useHydrated();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
        <span className="text-xl font-semibold">Lifestory</span>
        <Button asChild variant="outline" size="sm">
          <Link to="/sign-in">Sign in</Link>
        </Button>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-16 px-6 pt-6 pb-16 sm:gap-20 sm:pt-10">
        <section className="grid items-center gap-10 md:grid-cols-[1fr_1.1fr]">
          <div className="flex flex-col gap-5">
            <h1 className="text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">Picture books starring your family</h1>
            <p className="text-muted-foreground text-lg">
              Real stories by human authors and illustrators. You choose how each of your family looks, and every page is
              drawn with them.
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Button asChild size="lg">
                <Link to="/sign-in">Sign in</Link>
              </Button>
              <p className="text-muted-foreground text-sm">Lifestory is invite-only for now.</p>
            </div>
          </div>
          <figure className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <img
                src={paperBoatFamily1}
                alt="The Paper Boat, page 1: a fair-skinned boy with glasses points to the pond beside his mum, who has long brown hair"
                width={640}
                height={640}
                fetchPriority="high"
                className="aspect-square w-full rounded-lg border shadow-sm"
              />
              <img
                src={paperBoatFamily2}
                alt="The same page drawn with a dark-skinned girl with black braids and her mum, who has long black hair"
                width={640}
                height={640}
                fetchPriority="high"
                className="aspect-square w-full rounded-lg border shadow-sm"
              />
            </div>
            <figcaption className="text-muted-foreground text-center text-sm">
              The same page of <span className="italic">The Paper Boat</span>, drawn for two families.
            </figcaption>
          </figure>
        </section>

        <section aria-labelledby="how-it-works" className="flex flex-col gap-6">
          <h2 id="how-it-works" className="text-2xl font-semibold">
            How it works
          </h2>
          <ol className="grid gap-4 sm:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step.title} className="bg-card flex flex-col gap-2 rounded-xl border p-5">
                <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-full text-sm font-semibold">
                  {index + 1}
                </span>
                <h3 className="font-semibold">{step.title}</h3>
                <p className="text-muted-foreground text-sm">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="grid items-center gap-8 md:grid-cols-2">
          <div className="flex flex-col gap-3 md:order-2">
            <h2 className="text-2xl font-semibold">An illustrator's art, extended with AI</h2>
            <p className="text-muted-foreground">
              An illustrator draws each story's characters, then works with AI to turn those drawings into many faces,
              hairstyles, skin tones, and hair colours in the same style. The illustrator approves every option, so each
              person in your family can look like themselves on every page.
            </p>
            <p className="text-muted-foreground">Start from a look, then change one thing at a time with a live preview.</p>
            {!trying && (
              <Button variant="outline" className="self-start" disabled={!hydrated} onClick={() => setTrying(true)}>
                Try it: build a child
              </Button>
            )}
          </div>
          <img
            src={characterPicker}
            alt="The character picker: a portrait of a young child next to choices for age, face, skin tone, and hairstyle"
            width={1000}
            height={876}
            loading="lazy"
            className="w-full rounded-lg border shadow-sm md:order-1"
          />
        </section>
        {trying && (
          <section aria-labelledby="try-picker" className="-mt-8 flex scroll-mt-4 flex-col gap-3 sm:-mt-10" ref={(node) => node?.scrollIntoView({ behavior: "smooth", block: "start" })}>
            <h2 id="try-picker" className="text-xl font-semibold">
              Try the character picker
            </h2>
            <Suspense fallback={<p className="text-muted-foreground text-sm">Loading the picker…</p>}>
              <LandingLookDemo />
            </Suspense>
          </section>
        )}

        <section className="grid items-center gap-8 md:grid-cols-2">
          <div className="flex flex-col gap-3 md:order-2">
            <h2 className="text-2xl font-semibold">Your words, ready to print</h2>
            <p className="text-muted-foreground">
              Read each page as it will print and change the text if you like. Then download a print-ready PDF of the whole
              book, as in <span className="italic">The Moon Picnic</span>.
            </p>
          </div>
          <img
            src={moonPicnic}
            alt="The Moon Picnic: a brown-skinned girl and her grandpa have a picnic on the Moon"
            width={720}
            height={720}
            loading="lazy"
            className="aspect-square w-full max-w-sm justify-self-center rounded-lg border shadow-sm md:order-1"
          />
        </section>
      </main>

      <footer className="text-muted-foreground mx-auto w-full max-w-5xl px-6 pb-8 text-sm">
        <p className="border-t pt-6">
          Lifestory is invite-only for now. Have an invitation? Open the link in your email, or{" "}
          <Link to="/sign-in" className="text-foreground underline underline-offset-4">
            sign in
          </Link>
          .
        </p>
      </footer>
    </div>
  );
}
