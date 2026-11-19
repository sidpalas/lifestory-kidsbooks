// The one page component: the editor shows it scaled on screen, and the print
// route renders it at full size for the PDF proof, so both use the same layout,
// the same physical units (inches and points), and the same font files.
import type { CastMember, FontFile, Page, PlacedRect, ResolvedTextBlock, StoryManifest } from "@lifestory/core/contracts";
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
  /**
   * The composed illustration, bottom to top: art, and each figure's base face, parts, and occluder, recoloured for
   * the cast (packages/core looks/compose.ts). Rects are thousandths of the illustration area.
   */
  readonly illustration: ReadonlyArray<{ readonly url: string; readonly rect: PlacedRect }>;
  /** Who fills each character slot; labels the figure boxes in the guides. */
  readonly cast: Readonly<Record<string, CastMember>>;
  /** Show the trim line, the safe area, and each figure's box, for the editor. Never printed. */
  readonly guides?: boolean;
}

export function BookPage({ manifest, page, text, illustration, cast, guides = false }: BookPageProps) {
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
        {illustration.map(({ url, rect: [x0, y0, x1, y1] }, i) => (
          <img
            key={i}
            src={url}
            alt=""
            style={{
              position: "absolute",
              left: `${x0 / 10}%`,
              top: `${y0 / 10}%`,
              width: `${(x1 - x0) / 10}%`,
              height: `${(y1 - y0) / 10}%`,
            }}
          />
        ))}
        {guides &&
          page.illustration.layers.map((layer, i) =>
            layer.kind === "figure" ? (
              <FigureBox key={i} box={layer.box} name={cast[layer.slotId]?.name} label={slotLabels.get(layer.slotId) ?? layer.slotId} />
            ) : null,
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

/** A guide over a figure: its box, labelled with who fills it. */
function FigureBox({ box: [x0, y0, x1, y1], name, label }: { box: PlacedRect; name: string | undefined; label: string }) {
  return (
    <div
      data-testid="figure-box"
      style={{
        position: "absolute",
        left: `${x0 / 10}%`,
        top: `${y0 / 10}%`,
        width: `${(x1 - x0) / 10}%`,
        height: `${(y1 - y0) / 10}%`,
        border: "0.02in dashed #7a3fd1",
        borderRadius: "0.08in",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        font: "600 9pt/1.2 ui-sans-serif, system-ui, sans-serif",
        color: "#7a3fd1",
        padding: "0.04in",
        pointerEvents: "none",
      }}
    >
      <span style={{ background: "rgb(255 255 255 / 0.85)", borderRadius: "0.04in", padding: "0 0.04in", textAlign: "center" }}>
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
