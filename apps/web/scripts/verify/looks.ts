// verify looks: docs/features/story-looks.md. On a story's preview page, sets every role to the lightest and then the
// darkest skin with each hair colour, through the page's visual example pickers, and draws a contact sheet: one row per
// combination, one column per page. Checks every layer loads and every combination recolours the figures. Writes
// nothing (looks live in the URL).
import sharp from "sharp";
import { lookVocabulary } from "@lifestory/core/contracts";
import { imagesSettled, signedIn } from "./browser.ts";
import type { Report } from "./report.ts";
import type { Stack } from "./stack.ts";

const THUMB = 280;

export const looks = async (stack: Stack, report: Report, options: { story: string }) => {
  const session = await signedIn(stack);
  const { page } = session;
  try {
    await page.goto(`/stories/${options.story}`);
    await page.getByTestId("book-page").first().waitFor({ timeout: 30_000 });
    const roles = await page.getByRole("list", { name: "Roles" }).locator("select").evaluateAll((selects) => selects.map((select) => select.id.replace("cast-", "")));
    for (const role of roles) await page.locator(`#cast-${role}`).selectOption("example");
    for (const role of roles) await page.getByTestId(`try-${role}`).waitFor();
    const skins = [lookVocabulary.skin[0], lookVocabulary.skin.at(-1)!];
    report.check("route", roles.length > 0, `/stories/${options.story}: roles ${roles.join(", ")}; skins ${skins.map((s) => s.label).join(" and ")} × ${lookVocabulary.hairColour.length} hair colours`, { fatal: true });

    const rows: Buffer[][] = [];
    const labels: string[] = [];
    const seen = new Map<string, string>();
    let failures = 0;
    // The example looks the page opens with, so the first combination also has to redraw.
    seen.set(await page.getByTestId("book-page").evaluateAll((pages) => pages.map((p) => [...p.querySelectorAll("img")].map((img) => img.getAttribute("src")).join("|")).join("\n")), "the example looks");
    for (const skin of skins) {
      for (const colour of lookVocabulary.hairColour) {
        for (const role of roles) {
          const picker = page.getByTestId(`try-${role}`);
          await picker.getByRole("button", { name: `${skin.label} skin`, exact: true }).click();
          await picker.getByRole("button", { name: `${colour.label} hair colour`, exact: true }).click();
        }
        // The pages recompose on the server (recolouring each layer the first time), then the layer URLs change.
        const layerSources = () => page.getByTestId("book-page").evaluateAll((pages) => pages.map((p) => [...p.querySelectorAll("img")].map((img) => img.getAttribute("src")).join("|")).join("\n"));
        const deadline = Date.now() + 60_000;
        let sources = await layerSources();
        while (seen.has(sources) && Date.now() < deadline) {
          await page.waitForTimeout(250);
          sources = await layerSources();
        }
        const broken = await imagesSettled(page);
        const label = `${skin.label} skin, ${colour.label.toLowerCase()} hair`;
        const repeat = seen.get(sources);
        seen.set(sources, label);
        if (broken.length || repeat) failures++;
        report.check(label, !broken.length && !repeat, broken.length ? `${broken.length} layers failed: ${broken[0]}` : repeat ? `drew exactly what "${repeat}" drew` : "every layer loaded");
        const sheets = page.getByTestId("book-page");
        const row: Buffer[] = [];
        for (let i = 0; i < (await sheets.count()); i++) row.push(await sharp(await sheets.nth(i).screenshot()).resize(THUMB, THUMB, { fit: "contain", background: "#fff" }).png().toBuffer());
        rows.push(row);
        labels.push(label);
      }
    }
    // The contact sheet: a label strip, then the pages.
    const LABEL = 220;
    const columns = Math.max(...rows.map((row) => row.length));
    const composites = rows.flatMap((row, r) => [
      { input: Buffer.from(`<svg width="${LABEL}" height="${THUMB}"><text x="8" y="${THUMB / 2}" font-family="sans-serif" font-size="16">${labels[r]!.split(", ").map((part, i) => `<tspan x="8" dy="${i ? 20 : 0}">${part}</tspan>`).join("")}</text></svg>`), left: 0, top: r * THUMB },
      ...row.map((input, c) => ({ input, left: LABEL + c * THUMB, top: r * THUMB })),
    ]);
    await sharp({ create: { width: LABEL + columns * THUMB, height: rows.length * THUMB, channels: 3, background: "#fff" } })
      .composite(composites)
      .png()
      .toFile(report.file("contact-sheet.png"));
    report.facts.combinations = labels.length;
    report.check("contact sheet", failures === 0, `${labels.length} combinations × ${columns} pages in contact-sheet.png`);
  } finally {
    await session.close();
  }
};
