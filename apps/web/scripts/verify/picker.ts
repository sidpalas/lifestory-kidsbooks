// verify picker: docs/features/character-picker.md. Drives /characters/new as a parent does: name and pronouns, an
// age, then one feature at a time, and checks the portrait (/api/portrait) follows every choice and
// loads. It never presses "Add to the family", so it writes nothing.
import { writeFileSync } from "node:fs";
import { imagesSettled, signedIn } from "./browser.ts";
import type { Report } from "./report.ts";
import type { Stack } from "./stack.ts";

export const picker = async (stack: Stack, report: Report) => {
  const session = await signedIn(stack, { deviceScaleFactor: 2 });
  const { page } = session;
  try {
    await page.goto("/characters/new");
    report.check(
      "route",
      page.url().endsWith("/characters/new"),
      `signed in as ${stack.who}, at ${new URL(page.url()).pathname}`,
      { fatal: true },
    );
    await page.getByLabel("Name").fill("Verify Ada");
    await page.getByLabel("Pronouns").selectOption("she/her");
    const preview = page.getByTestId("look-preview");
    const summary = page.getByTestId("look-summary");

    // Each step: the user's click, then the summary it must produce; the portrait URL must change and load.
    const steps: Array<[string, () => Promise<void>, string]> = [
      // The form starts at Young child, so go to another age and back: both must redraw the portrait.
      ["age older", () => page.getByRole("button", { name: "Older child", exact: true }).click(), "Older child"],
      ["age young", () => page.getByRole("button", { name: "Young child", exact: true }).click(), "Young child"],
      // Then down the steps in order (D50); each changes only its own axis.
      [
        "skin",
        () => page.getByRole("button", { name: "Very light skin" }).click(),
        "Young child, round face, very light skin, curly black hair",
      ],
      [
        "face",
        () => page.getByRole("button", { name: "Oval face" }).click(),
        "Young child, oval face, very light skin, curly black hair",
      ],
      [
        "hairstyle",
        () => page.getByRole("button", { name: "Long hair" }).click(),
        "Young child, oval face, very light skin, long black hair",
      ],
      [
        "hair colour",
        () => page.getByRole("button", { name: "Red hair colour" }).click(),
        "Young child, oval face, very light skin, long red hair",
      ],
      [
        "glasses",
        () => page.getByRole("button", { name: "Round glasses" }).click(),
        "Young child, oval face, very light skin, long red hair, glasses",
      ],
    ];
    const portraits: string[] = [];
    for (const [name, act, expected] of steps) {
      const before = await preview.getAttribute("src");
      await act();
      await page
        .waitForFunction(
          (src) => document.querySelector("[data-testid=look-preview]")?.getAttribute("src") !== src,
          before,
          { timeout: 10_000 },
        )
        .catch(() => undefined);
      const src = (await preview.getAttribute("src"))!;
      const text = (await summary.textContent())?.trim() ?? "";
      const loaded = await preview.evaluate(async (img: HTMLImageElement) => {
        await img.decode().catch(() => undefined);
        return img.naturalWidth > 0;
      });
      portraits.push(src);
      const ok = text.startsWith(expected) && src !== before && loaded;
      report.check(
        `step ${name}`,
        ok,
        `summary "${text}"; portrait ${src === before ? "did not change" : "changed"}${loaded ? " and loaded" : ", FAILED to load"}`,
      );
      await page.screenshot({
        path: report.file(`picker-${portraits.length}-${name.replace(/ /g, "-")}.png`),
        clip: (await page.getByTestId("look-picker").boundingBox()) ?? undefined,
      });
    }
    const broken = await imagesSettled(page);
    report.check(
      "thumbnails",
      broken.length === 0,
      broken.length ? `${broken.length} broken: ${broken.slice(0, 3).join(", ")}` : "every option thumbnail loaded",
    );
    // The portrait endpoint itself: each URL the picker used answers an image.
    const types = await Promise.all(
      portraits.map(async (src) => (await page.request.get(src)).headers()["content-type"] ?? ""),
    );
    report.check(
      "portrait api",
      types.every((type) => type.startsWith("image/")),
      `${types.length} /api/portrait responses: ${[...new Set(types)].join(", ")}`,
    );
    await page.screenshot({ path: report.file("picker-final.png"), fullPage: true });
    writeFileSync(report.file("portraits.txt"), `${portraits.join("\n")}\n`);
  } finally {
    await session.close();
  }
};
