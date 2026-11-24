// The one page component: the editor shows it scaled on screen, and the print
// route renders it at full size for the PDF proof, so both use the same layout,
// the same physical units (inches and points), and the same font files.
import type {
  CastMember,
  FontFile,
  Page,
  PlacedRect,
  ResolvedTextBlock,
  StoryManifest,
} from "@lifestory/core/contracts";
import type * as React from "react";
import { useLayoutEffect, useRef, useState } from "react";

const inch = (n: number) => `${n}in`;

/** The page's full size: the trim plus bleed on every side, which is the printed sheet before cutting. */
export const pageSizeIn = (trim: StoryManifest["trim"]) => ({
  widthIn: trim.widthIn + 2 * trim.bleedIn,
  heightIn: trim.heightIn + 2 * trim.bleedIn,
});

/** @font-face rules for a story's fonts, loaded from its assets. Render once per document. */
export function StoryFonts({
  fonts,
  assetUrl,
}: {
  fonts: ReadonlyArray<FontFile>;
  assetUrl: (asset: string) => string;
}) {
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
  /** The page's paragraphs in reading order (pageText), tokens resolved (and, in a book, the family's edits applied). */
  readonly text: ReadonlyArray<ResolvedTextBlock>;
  /**
   * The composed illustration, bottom to top: art, and each figure's base face, parts, and occluder, recoloured for
   * the cast (packages/core looks/compose.ts). Rects are thousandths of the illustration area.
   */
  readonly illustration: ReadonlyArray<{ readonly url: string; readonly rect: PlacedRect }>;
  /** Who fills each character slot; labels the figure boxes in the guides. */
  readonly cast: Readonly<Record<string, CastMember>>;
  /** Show the trim line, the safe area, each figure's box and each text frame, for the editor. Never printed. */
  readonly guides?: boolean;
  /** Told which text frames (by index) hold more text than fits, whenever that changes. */
  readonly onOverflow?: (frames: ReadonlyArray<number>) => void;
}

export function BookPage({ manifest, page, text, illustration, cast, guides = false, onOverflow }: BookPageProps) {
  const { trim, textStyles } = manifest;
  const { widthIn, heightIn } = pageSizeIn(trim);
  const slotLabels = new Map(manifest.characterSlots.map((slot) => [slot.slotId, slot.label]));
  const { overflowing, sheet } = useOverflow(page.frames.length, onOverflow);
  // `text` is the page's paragraphs in reading order (pageText); each frame takes the next ones.
  const frames = page.frames.map((frame, f) => {
    const first = page.frames.slice(0, f).reduce((n, earlier) => n + earlier.paragraphs.length, 0);
    return { frame, paragraphs: text.slice(first, first + frame.paragraphs.length) };
  });

  return (
    <div
      ref={sheet}
      data-testid="book-page"
      data-page-id={page.pageId}
      style={{
        position: "relative",
        width: inch(widthIn),
        height: inch(heightIn),
        overflow: "hidden",
        background: "#fffaf0",
        color: "#2b2118",
      }}
    >
      <div
        data-testid="illustration"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          height: "100%",
          width: page.art === "left-half" ? inch(trim.bleedIn + trim.widthIn / 2) : "100%",
        }}
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
            layer.kind === "photoFigure" ? (
              <FigureBox
                key={i}
                box={layer.box}
                name={cast[layer.slotId]?.name}
                label={slotLabels.get(layer.slotId) ?? layer.slotId}
              />
            ) : null,
          )}
      </div>

      {frames.map(({ frame, paragraphs }, f) =>
        paragraphs.length === 0 ? null : (
          <div
            key={frame.frameId}
            data-testid="text-frame"
            data-frame={f}
            data-overflow={overflowing.includes(f) || undefined}
            style={{
              position: "absolute",
              left: inch(trim.bleedIn + frame.box.xIn),
              top: inch(trim.bleedIn + frame.box.yIn),
              width: inch(frame.box.widthIn),
              height: inch(frame.box.heightIn),
              display: "flex",
              flexDirection: "column",
              justifyContent: { top: "flex-start", middle: "center", bottom: "flex-end" }[frame.valign],
              ...(guides
                ? { outline: `0.01in dashed ${overflowing.includes(f) ? "#d92d20" : "#0f9d58"}`, outlineOffset: 0 }
                : {}),
            }}
          >
            {/* As tall as the text, so a frame keeping to its bottom grows upward, panel and all. */}
            <div data-testid="text-panel" style={{ flexShrink: 0, ...(frame.panel ? panelStyle : {}) }}>
              {paragraphs.map((block, i) => {
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
                      // Lines break where the author or family typed a break, and where they run out of room.
                      whiteSpace: "pre-line",
                      // Lay out with the font's own fractional advances. Without it the worker's headless Chromium
                      // rounds each word to whole CSS pixels, so print drifted up to 3.4 pt along a line from the
                      // editor (D12).
                      textRendering: "geometricPrecision",
                    }}
                  >
                    {block.text}
                  </p>
                );
              })}
            </div>
          </div>
        ),
      )}

      {guides && (
        <>
          <Guide inset={trim.bleedIn} color="#e0218a" testId="trim-guide" />
          <Guide inset={trim.bleedIn + trim.safeMarginIn} color="#00a3d9" testId="safe-guide" />
        </>
      )}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  background: "rgb(255 250 240 / 0.9)",
  borderRadius: "0.14in",
  padding: "0.16in 0.22in",
};

/**
 * Which text frames on this page (by index) hold more text than fits: a family's longer names or edit can make a
 * frame overflow, and the text then prints past it. Measured after layout and again whenever a frame or its text
 * resizes (fonts loading, edits typed, frames moved).
 */
function useOverflow(frames: number, onOverflow: ((frames: ReadonlyArray<number>) => void) | undefined) {
  const [overflowing, setOverflowing] = useState<ReadonlyArray<number>>([]);
  const sheet = useRef<HTMLDivElement>(null);
  const callback = useRef(onOverflow);
  useLayoutEffect(() => {
    callback.current = onOverflow;
  });
  useLayoutEffect(() => {
    const page = sheet.current!;
    const measure = () => {
      const next = [...page.querySelectorAll<HTMLElement>("[data-testid=text-frame]")]
        // Half a CSS pixel of slack for sub-pixel line heights.
        .filter(
          (frame) =>
            frame.querySelector<HTMLElement>("[data-testid=text-panel]")!.offsetHeight > frame.clientHeight + 0.5,
        )
        .map((frame) => Number(frame.dataset.frame));
      setOverflowing((current) => (current.join() === next.join() ? current : next));
    };
    const observer = new ResizeObserver(measure);
    for (const element of page.querySelectorAll("[data-testid=text-frame], [data-testid=text-panel]"))
      observer.observe(element);
    measure();
    return () => observer.disconnect();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- frames: an added frame needs observing too
  }, [frames]);
  useLayoutEffect(() => callback.current?.(overflowing), [overflowing]);
  return { overflowing, sheet };
}

/** A guide over a figure: its box, labelled with who fills it. */
function FigureBox({
  box: [x0, y0, x1, y1],
  name,
  label,
}: {
  box: PlacedRect;
  name: string | undefined;
  label: string;
}) {
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
      <span
        style={{
          background: "rgb(255 255 255 / 0.85)",
          borderRadius: "0.04in",
          padding: "0 0.04in",
          textAlign: "center",
        }}
      >
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

/**
 * Shows a page at `scale` on screen, or smaller when its container is narrower, keeping the page's shape. The page
 * inside keeps its physical size, so layout is identical to print.
 */
export function ScaledPage({
  trim,
  scale,
  children,
}: {
  trim: StoryManifest["trim"];
  scale: number;
  children: React.ReactNode;
}) {
  const { widthIn, heightIn } = pageSizeIn(trim);
  const box = useRef<HTMLDivElement>(null);
  const [fitted, setFitted] = useState(scale);
  useLayoutEffect(() => {
    const element = box.current!;
    // 96 CSS px to the inch.
    const observer = new ResizeObserver(() => setFitted(element.clientWidth / (widthIn * 96)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [widthIn]);
  return (
    <div ref={box} style={{ position: "relative", overflow: "hidden" }}>
      {/* Sizes the box: up to the page at `scale`, down to its container's width. As a replaced element with a
          percentage max-width it asks for no minimum width, so narrow grid cells and flex rows can shrink it. */}
      <svg
        aria-hidden
        viewBox={`0 0 ${widthIn} ${heightIn}`}
        style={{ display: "block", width: `calc(${inch(widthIn)} * ${scale})`, maxWidth: "100%", height: "auto" }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          transform: `scale(${fitted})`,
          transformOrigin: "top left",
          width: inch(widthIn),
        }}
      >
        {children}
      </div>
    </div>
  );
}
