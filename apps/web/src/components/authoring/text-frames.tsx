// Placing a page's text frames in the draft editor (D54): drag a frame on the preview to move it, drag its edges or
// corners to resize it, or focus it and use the arrow keys; the Pages tab holds the same box as numbers, in inches.
// Frames stay inside the safe area.
import { presetFrame, safeArea, type StoryDraft, type TextFrame, type TrimBox } from "@lifestory/core/contracts";
import type * as React from "react";
import { useRef, useState } from "react";

import { Input } from "~/components/ui/input";

type Trim = StoryDraft["trim"];
type Edges = { readonly left?: true; readonly top?: true; readonly right?: true; readonly bottom?: true };

/** The smallest frame: a quarter of an inch either way. */
const MIN_SIZE_IN = 0.25;
/** Stored boxes are rounded to a thousandth of an inch (0.07 pt), so dragging doesn't store float noise. */
const round = (inches: number) => Math.round(inches * 1000) / 1000;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/** Moves a box by (dx, dy) inches, or moves the given edges, keeping it inside the safe area. */
export const placeBox = (box: TrimBox, trim: Trim, dx: number, dy: number, edges?: Edges): TrimBox => {
  const safe = safeArea(trim);
  const [sx1, sy1] = [safe.xIn + safe.widthIn, safe.yIn + safe.heightIn];
  const [x0, y0, x1, y1] = [box.xIn, box.yIn, box.xIn + box.widthIn, box.yIn + box.heightIn];
  if (!edges) {
    const widthIn = Math.min(box.widthIn, safe.widthIn);
    const heightIn = Math.min(box.heightIn, safe.heightIn);
    return {
      xIn: round(clamp(x0 + dx, safe.xIn, sx1 - widthIn)),
      yIn: round(clamp(y0 + dy, safe.yIn, sy1 - heightIn)),
      widthIn,
      heightIn,
    };
  }
  const nx0 = edges.left ? clamp(x0 + dx, safe.xIn, x1 - MIN_SIZE_IN) : x0;
  const ny0 = edges.top ? clamp(y0 + dy, safe.yIn, y1 - MIN_SIZE_IN) : y0;
  const nx1 = edges.right ? clamp(x1 + dx, x0 + MIN_SIZE_IN, sx1) : x1;
  const ny1 = edges.bottom ? clamp(y1 + dy, y0 + MIN_SIZE_IN, sy1) : y1;
  return { xIn: round(nx0), yIn: round(ny0), widthIn: round(nx1 - nx0), heightIn: round(ny1 - ny0) };
};

/** The starting frames the editor offers: format 2's layouts, and a smaller frame to place freely. */
export const FRAME_PRESETS = {
  bottom: "Along the bottom",
  top: "Along the top",
  "right-half": "Right half",
  free: "A small frame to place",
} as const;
export type FramePreset = keyof typeof FRAME_PRESETS;

export const newFrame = (trim: Trim, preset: FramePreset, frameId: string): TextFrame => {
  const paragraphs = [{ style: "body" as const, content: "" }];
  if (preset !== "free") return presetFrame(trim, preset, frameId, paragraphs);
  const safe = safeArea(trim);
  const box = { xIn: safe.xIn, yIn: safe.yIn, widthIn: round(safe.widthIn / 2), heightIn: round(safe.heightIn / 4) };
  return { frameId, box, valign: "top", panel: true, paragraphs };
};

export const nextFrameId = (frames: ReadonlyArray<TextFrame>) => {
  const used = new Set(frames.map((frame) => frame.frameId));
  let n = frames.length + 1;
  while (used.has(`t${n}`)) n++;
  return `t${n}`;
};

const HANDLES: ReadonlyArray<{ edges: Edges; left: string; top: string; cursor: string; name: string }> = [
  { edges: { left: true, top: true }, left: "0%", top: "0%", cursor: "nwse-resize", name: "top-left" },
  { edges: { top: true }, left: "50%", top: "0%", cursor: "ns-resize", name: "top" },
  { edges: { right: true, top: true }, left: "100%", top: "0%", cursor: "nesw-resize", name: "top-right" },
  { edges: { right: true }, left: "100%", top: "50%", cursor: "ew-resize", name: "right" },
  { edges: { right: true, bottom: true }, left: "100%", top: "100%", cursor: "nwse-resize", name: "bottom-right" },
  { edges: { bottom: true }, left: "50%", top: "100%", cursor: "ns-resize", name: "bottom" },
  { edges: { left: true, bottom: true }, left: "0%", top: "100%", cursor: "nesw-resize", name: "bottom-left" },
  { edges: { left: true }, left: "0%", top: "50%", cursor: "ew-resize", name: "left" },
];

const fmt = (inches: number) => inches.toFixed(2);

/**
 * The movable frames over a page preview. Place it over the ScaledPage that shows the page, in a container the same
 * size; it covers the trim, so a frame's inches are fractions of this overlay.
 */
export function TextFrameOverlay({
  trim,
  frames,
  overflowing,
  onChange,
  onOpen,
}: {
  trim: Trim;
  frames: ReadonlyArray<TextFrame>;
  overflowing: ReadonlyArray<number>;
  onChange: (frame: number, box: TrimBox) => void;
  /** Focus the frame's first paragraph, from a double click or Enter on it. */
  onOpen: (frame: number) => void;
}) {
  const area = useRef<HTMLDivElement>(null);
  const drag = useRef<{ frame: number; box: TrimBox; x: number; y: number; edges?: Edges } | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const pageWidth = trim.widthIn + 2 * trim.bleedIn;
  const pageHeight = trim.heightIn + 2 * trim.bleedIn;

  const start = (event: React.PointerEvent, frame: number, box: TrimBox, edges?: Edges) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    (event.currentTarget.closest("[data-frame-handle]") as HTMLElement | null)?.focus();
    drag.current = { frame, box, x: event.clientX, y: event.clientY, ...(edges ? { edges } : {}) };
  };
  const move = (event: React.PointerEvent) => {
    const current = drag.current;
    if (!current || !area.current) return;
    const bounds = area.current.getBoundingClientRect();
    const dx = ((event.clientX - current.x) / bounds.width) * trim.widthIn;
    const dy = ((event.clientY - current.y) / bounds.height) * trim.heightIn;
    onChange(current.frame, placeBox(current.box, trim, dx, dy, current.edges));
  };
  const end = () => {
    drag.current = null;
  };

  return (
    <div
      ref={area}
      data-testid="text-frame-overlay"
      style={{
        position: "absolute",
        left: `${(trim.bleedIn / pageWidth) * 100}%`,
        top: `${(trim.bleedIn / pageHeight) * 100}%`,
        width: `${(trim.widthIn / pageWidth) * 100}%`,
        height: `${(trim.heightIn / pageHeight) * 100}%`,
        pointerEvents: "none",
      }}
    >
      {frames.map(({ frameId, box }, f) => {
        const focused = active === f;
        return (
          <div
            key={frameId}
            data-frame-handle={f}
            tabIndex={0}
            role="group"
            aria-roledescription="movable text frame"
            aria-label={`Text frame ${f + 1}: ${fmt(box.xIn)} in from the left, ${fmt(box.yIn)} in from the top, ${fmt(box.widthIn)} × ${fmt(box.heightIn)} in`}
            title="Drag to move, drag an edge to resize. Arrow keys move 0.01 in (Shift: 0.1 in), Alt+arrows resize."
            onFocus={() => setActive(f)}
            onBlur={() => setActive((current) => (current === f ? null : current))}
            onPointerDown={(event) => start(event, f, box)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onDoubleClick={() => onOpen(f)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                return onOpen(f);
              }
              const step = event.shiftKey ? 0.1 : 0.01;
              const delta = {
                ArrowLeft: [-step, 0],
                ArrowRight: [step, 0],
                ArrowUp: [0, -step],
                ArrowDown: [0, step],
              }[event.key];
              if (!delta) return;
              event.preventDefault();
              onChange(
                f,
                placeBox(box, trim, delta[0]!, delta[1]!, event.altKey ? { right: true, bottom: true } : undefined),
              );
            }}
            className="outline-none"
            style={{
              position: "absolute",
              left: `${(box.xIn / trim.widthIn) * 100}%`,
              top: `${(box.yIn / trim.heightIn) * 100}%`,
              width: `${(box.widthIn / trim.widthIn) * 100}%`,
              height: `${(box.heightIn / trim.heightIn) * 100}%`,
              pointerEvents: "auto",
              cursor: "move",
              touchAction: "none",
              border: focused ? "2px solid #2563eb" : "1px solid transparent",
              boxShadow: focused ? "0 0 0 1px white" : undefined,
            }}
          >
            {overflowing.includes(f) && (
              <span
                className="absolute -top-5 left-0 rounded bg-red-600 px-1 text-[10px] whitespace-nowrap text-white"
                aria-hidden
              >
                Text runs past this frame
              </span>
            )}
            {focused &&
              HANDLES.map((handle) => (
                <span
                  key={handle.name}
                  aria-hidden
                  onPointerDown={(event) => start(event, f, box, handle.edges)}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerCancel={end}
                  style={{
                    position: "absolute",
                    left: handle.left,
                    top: handle.top,
                    width: 12,
                    height: 12,
                    transform: "translate(-50%, -50%)",
                    background: "white",
                    border: "2px solid #2563eb",
                    borderRadius: 2,
                    cursor: handle.cursor,
                    touchAction: "none",
                  }}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}

/** A frame's box as inch fields, its anchoring, and its panel. */
export function FrameFields({
  trim,
  frame,
  index,
  onChange,
}: {
  trim: Trim;
  frame: TextFrame;
  index: number;
  onChange: (frame: TextFrame) => void;
}) {
  const { box } = frame;
  const set = (edit: (box: TrimBox) => TrimBox) => onChange({ ...frame, box: edit(box) });
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <InchField
          label="From left (in)"
          value={box.xIn}
          onChange={(value) => set((b) => placeBox(b, trim, value - b.xIn, 0))}
        />
        <InchField
          label="From top (in)"
          value={box.yIn}
          onChange={(value) => set((b) => placeBox(b, trim, 0, value - b.yIn))}
        />
        <InchField
          label="Width (in)"
          value={box.widthIn}
          onChange={(value) => set((b) => placeBox(b, trim, value - b.widthIn, 0, { right: true }))}
        />
        <InchField
          label="Height (in)"
          value={box.heightIn}
          onChange={(value) => set((b) => placeBox(b, trim, 0, value - b.heightIn, { bottom: true }))}
        />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs">
          Text keeps to
          <select
            aria-label={`Vertical alignment of text frame ${index + 1}`}
            className="h-8 rounded-md border bg-transparent px-2 text-sm"
            value={frame.valign}
            onChange={(event) => onChange({ ...frame, valign: event.target.value as TextFrame["valign"] })}
          >
            <option value="top">the top (grows down)</option>
            <option value="middle">the middle</option>
            <option value="bottom">the bottom (grows up)</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            aria-label={`Light panel behind text frame ${index + 1}`}
            checked={frame.panel}
            onChange={(event) => onChange({ ...frame, panel: event.target.checked })}
          />
          Light panel behind the text
        </label>
      </div>
    </div>
  );
}

/**
 * A length in inches. While it's focused the field keeps what's typed, so it can be emptied and retyped; the frame
 * moves on each complete number, and the field shows the frame's own value again when it loses focus.
 */
function InchField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <label className="flex flex-col gap-1 text-xs">
      {label}
      <Input
        type="number"
        step={0.05}
        value={typed ?? Number(value.toFixed(3))}
        onChange={(event) => {
          setTyped(event.target.value);
          if (Number.isFinite(event.target.valueAsNumber)) onChange(event.target.valueAsNumber);
        }}
        onBlur={() => setTyped(null)}
        className="h-8"
      />
    </label>
  );
}
