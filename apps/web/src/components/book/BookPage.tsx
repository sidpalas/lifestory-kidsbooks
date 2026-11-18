// The one page component: the editor shows it scaled on screen, and the print
// route renders it at full size for the PDF proof, so both use the same layout,
// the same physical units (inches and points), and the same font files.
import type { CastMember, FontFile, Page, ResolvedTextBlock, StoryManifest } from "@lifestory/core/contracts";
import type * as React from "react";

const inch = (n: number) => `${n}in`;

/** The page's full size: the trim plus bleed on every side, which is the printed sheet before cutting. */
export const pageSizeIn = (trim: StoryManifest["trim"]) => ({
  widthIn: trim.widthIn + 2 * trim.bleedIn,
  heightIn: trim.heightIn + 2 * trim.bleedIn,
});

/** @font-face rules for a story's fonts, loaded from its assets. Render once per document. */
export function StoryFonts({ fonts, assetUrl }: { fonts: ReadonlyArray<FontFile>; assetUrl: (asset: string) => string }) {
  const css = fonts
    .map((font) =>
      [
        `@font-face {`,
        `  font-family: ${JSON.stringify(font.family)};`,
        `  src: url(${JSON.stringify(assetUrl(font.asset))}) format("woff2");`,
        font.weight ? `  font-weight: ${font.weight};` : "",
        font.style ? `  font-style: ${font.style};` : "",
        font.unicodeRange ? `  unicode-range: ${font.unicodeRange};` : "",
        // Print must never fall back to another font, so wait for the real one.
        `  font-display: block;`,
        `}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n");
  return <style>{css}</style>;
}

export interface BookPageProps {
  readonly manifest: StoryManifest;
  readonly page: Page;
  /** The page's text, tokens already resolved (and, in a book, the family's edits applied). */
  readonly text: ReadonlyArray<ResolvedTextBlock>;
  /** Who fills each character slot; labels the slots until the page is generated. */
  readonly cast: Readonly<Record<string, CastMember>>;
  readonly assetUrl: (asset: string) => string;
  /** Show the trim line and the safe area, for the editor. Never printed. */
  readonly guides?: boolean;
}

export function BookPage({ manifest, page, text, cast, assetUrl, guides = false }: BookPageProps) {
  const { trim, textStyles } = manifest;
  const { widthIn, heightIn } = pageSizeIn(trim);
  const inset = trim.bleedIn + trim.safeMarginIn;
  const artLeft = page.layout === "art-left/text-right";
  const slotLabels = new Map(manifest.characterSlots.map((slot) => [slot.slotId, slot.label]));

  const textArea: React.CSSProperties = artLeft
    ? { left: inch(trim.bleedIn + trim.widthIn / 2 + trim.safeMarginIn), right: inch(inset), top: inch(inset), bottom: inch(inset), justifyContent: "center" }
    : page.layout === "full-bleed-art/text-top"
      ? { left: inch(inset), right: inch(inset), top: inch(inset) }
      : { left: inch(inset), right: inch(inset), bottom: inch(inset) };

  return (
    <div
      data-testid="book-page"
      data-page-id={page.pageId}
      style={{ position: "relative", width: inch(widthIn), height: inch(heightIn), overflow: "hidden", background: "#fffaf0", color: "#2b2118" }}
    >
      <div
        data-testid="illustration"
        style={{ position: "absolute", left: 0, top: 0, height: "100%", width: artLeft ? inch(trim.bleedIn + trim.widthIn / 2) : "100%" }}
      >
        {page.illustration.layers.map((layer, i) =>
          layer.kind === "art" ? (
            <img
              key={i}
              src={assetUrl(layer.asset)}
              alt=""
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <CharacterSlotBox key={i} box={layer.box} name={cast[layer.slotId]?.name} label={slotLabels.get(layer.slotId) ?? layer.slotId} />
          ),
        )}
      </div>

      <div data-testid="page-text" style={{ position: "absolute", display: "flex", flexDirection: "column", gap: "0.12in", ...textArea }}>
        <div
          style={
            artLeft
              ? undefined
              : { background: "rgb(255 250 240 / 0.9)", borderRadius: "0.14in", padding: "0.16in 0.22in" }
          }
        >
          {text.map((block, i) => {
            const style = textStyles[block.style];
            return (
              <p
                key={i}
                style={{
                  margin: i === 0 ? 0 : "0.5em 0 0",
                  fontFamily: `${JSON.stringify(style.fontFamily)}, serif`,
                  fontSize: `${style.sizePt}pt`,
                  lineHeight: style.lineHeight,
                  fontWeight: style.weight,
                  textAlign: style.align,
                }}
              >
                {block.text}
              </p>
            );
          })}
        </div>
      </div>

      {guides && (
        <>
          <Guide inset={trim.bleedIn} color="#e0218a" testId="trim-guide" />
          <Guide inset={inset} color="#00a3d9" testId="safe-guide" />
        </>
      )}
    </div>
  );
}

/** A character slot not yet filled with generated art: its box, labelled with who will be drawn there. */
function CharacterSlotBox({ box: [y0, x0, y1, x1], name, label }: { box: readonly [number, number, number, number]; name: string | undefined; label: string }) {
  return (
    <div
      data-testid="character-slot"
      style={{
        position: "absolute",
        top: `${y0 / 10}%`,
        left: `${x0 / 10}%`,
        height: `${(y1 - y0) / 10}%`,
        width: `${(x1 - x0) / 10}%`,
        border: "0.025in dashed rgb(43 33 24 / 0.7)",
        borderRadius: "0.08in",
        background: "rgb(255 255 255 / 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        font: "600 11pt/1.2 ui-sans-serif, system-ui, sans-serif",
        padding: "0.05in",
      }}
    >
      <span>
        {name ?? label}
        {name && <span style={{ display: "block", fontWeight: 400, opacity: 0.75 }}>{label}</span>}
      </span>
    </div>
  );
}

function Guide({ inset, color, testId }: { inset: number; color: string; testId: string }) {
  return (
    <div
      data-testid={testId}
      style={{ position: "absolute", inset: inch(inset), border: `0.01in dashed ${color}`, pointerEvents: "none" }}
    />
  );
}

/** Shows a page at `scale` on screen. The page inside keeps its physical size, so layout is identical to print. */
export function ScaledPage({ trim, scale, children }: { trim: StoryManifest["trim"]; scale: number; children: React.ReactNode }) {
  const { widthIn, heightIn } = pageSizeIn(trim);
  return (
    <div style={{ width: `calc(${inch(widthIn)} * ${scale})`, height: `calc(${inch(heightIn)} * ${scale})`, overflow: "hidden" }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: inch(widthIn) }}>{children}</div>
    </div>
  );
}
