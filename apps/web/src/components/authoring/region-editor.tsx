// The hair region of a figure (D56): a polygon the author draws over the base, where its generated parts may appear.
// Click to add a point after the last one, or on an edge to add it there; drag a point to move it, and double-click
// one to remove it. A hairstyle's current cut can be shown over the base to see what the region keeps.
import type { Region, StoryPart } from "@lifestory/core/contracts";
import { useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { NativeSelect } from "~/components/ui/native-select";

export type Point = readonly [number, number];

const clamp = (v: number) => Math.max(0, Math.min(1000, Math.round(v)));

/** Squared distance from `p` to the segment a–b. */
const toSegment = ([px, py]: Point, [ax, ay]: Point, [bx, by]: Point) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
};

/**
 * `points` with `p` added: into the edge it was clicked on (within `near` thousandths), else after the last point,
 * so tracing an outline point by point keeps them in order.
 */
const withPoint = (points: ReadonlyArray<Point>, p: Point, near: number): ReadonlyArray<Point> => {
  const edges = points.length < 3 ? points.length - 1 : points.length;
  for (let i = 0; i < edges; i++)
    if (toSegment(p, points[i]!, points[(i + 1) % points.length]!) <= near * near)
      return [...points.slice(0, i + 1), p, ...points.slice(i + 1)];
  return [...points, p];
};

export function RegionEditor({
  baseUrl,
  points,
  onPoints,
  saved,
  parts,
  recuttable,
  blocked,
  onSave,
}: {
  /** The figure's base drawing, which the region's thousandths are of. */
  baseUrl: string;
  /** The region as drawn here, which the next parts generated use too. */
  points: ReadonlyArray<Point>;
  onPoints: (update: (points: ReadonlyArray<Point>) => ReadonlyArray<Point>) => void;
  /** The region the figure's parts are cut within now, or null. */
  saved: Region | null;
  /** The figure's generated parts, to preview one option's cut. */
  parts: ReadonlyArray<StoryPart>;
  /** How many parts saving cuts out again. */
  recuttable: number;
  blocked: string | null;
  onSave: (region: Region | null) => void;
}) {
  const setPoints = (next: ReadonlyArray<Point> | ((points: ReadonlyArray<Point>) => ReadonlyArray<Point>)) =>
    onPoints(typeof next === "function" ? next : () => next);
  const [shown, setShown] = useState("");
  const [zoom, setZoom] = useState(1);
  const dragging = useRef<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLDivElement>(null);
  // Zoomed in, show the region (or the top of the figure, where heads usually are) rather than the corner.
  const zoomTo = (next: number) => {
    setZoom(next);
    const [cx, cy] =
      points.length > 0
        ? [
            (Math.min(...points.map(([x]) => x)) + Math.max(...points.map(([x]) => x))) / 2,
            (Math.min(...points.map(([, y]) => y)) + Math.max(...points.map(([, y]) => y))) / 2,
          ]
        : [500, 200];
    requestAnimationFrame(() => {
      const outer = view.current!;
      const inner = box.current!;
      outer.scrollTo({
        left: (cx / 1000) * inner.offsetWidth - outer.clientWidth / 2,
        top: (cy / 1000) * inner.offsetHeight - outer.clientHeight / 2,
      });
    });
  };
  const at = (event: { clientX: number; clientY: number }): Point => {
    const rect = box.current!.getBoundingClientRect();
    return [
      clamp(((event.clientX - rect.left) / rect.width) * 1000),
      clamp(((event.clientY - rect.top) / rect.height) * 1000),
    ];
  };
  const region = points.length >= 3 ? (points as Region) : null;
  const changed = JSON.stringify(region) !== JSON.stringify(saved);
  const options = [...new Set(parts.filter((part) => part.layers.length > 0).map((part) => part.option))];
  const preview = parts.findLast((part) => part.option === shown && part.layers.length > 0);

  return (
    <fieldset className="flex flex-col gap-2 text-xs" data-testid="region-editor">
      <legend className="mb-1 font-medium">Hair region</legend>
      <p className="text-muted-foreground">
        Outline where hair may appear, around the head and anything it falls over, leaving out what's in front of it (a
        helmet's shell, a hat's crown, an arm). Click to add a point, drag to move one, double-click to remove it. Every
        part of this figure is clipped to it, and saving cuts the generated ones out again from their edits, at no cost.
      </p>
      <div className="flex flex-wrap items-start gap-3">
        <div ref={view} className="max-h-[32rem] w-full max-w-md overflow-auto border">
          <div
            ref={box}
            className="relative cursor-crosshair touch-none bg-[repeating-conic-gradient(#e5e5e5_0_25%,#fff_0_50%)] bg-[length:16px_16px] select-none"
            style={{ width: `${zoom * 100}%` }}
            data-testid="region-canvas"
            onPointerDown={(event) => {
              if (event.button !== 0 || dragging.current !== null) return;
              setPoints((current) => withPoint(current, at(event), 8 / zoom));
            }}
            onPointerMove={(event) => {
              const index = dragging.current;
              if (index === null) return;
              const p = at(event);
              setPoints((current) => current.map((q, i) => (i === index ? p : q)));
            }}
            onPointerUp={() => {
              dragging.current = null;
            }}
          >
            <img src={baseUrl} alt="The figure's base" className="pointer-events-none block w-full" draggable={false} />
            {preview?.layers.map((layer) => (
              <img
                key={layer.key}
                src={`/api/files/${layer.key}`}
                alt=""
                className="pointer-events-none absolute"
                // The cut is in neutral greys until a palette recolours it; tinted, it stands out on any base.
                style={{
                  filter: "sepia(1) saturate(6) hue-rotate(-40deg)",
                  left: `${layer.at[0] / 10}%`,
                  top: `${layer.at[1] / 10}%`,
                  width: `${(layer.at[2] - layer.at[0]) / 10}%`,
                  height: `${(layer.at[3] - layer.at[1]) / 10}%`,
                }}
              />
            ))}
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
            >
              <polygon
                points={points.map(([x, y]) => `${x},${y}`).join(" ")}
                fill="rgb(37 99 235 / 0.15)"
                stroke="rgb(37 99 235)"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {points.map(([x, y], i) => (
              <span
                // oxlint-disable-next-line react/no-array-index-key -- a point is its place in the polygon
                key={i}
                role="button"
                aria-label={`Region point ${i + 1}`}
                tabIndex={-1}
                className="absolute size-3 -translate-1/2 cursor-move rounded-full border-2 border-white bg-blue-600 shadow"
                style={{ left: `${x / 10}%`, top: `${y / 10}%` }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  dragging.current = i;
                  box.current!.setPointerCapture(event.pointerId);
                }}
                onDoubleClick={() => setPoints((current) => current.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 font-medium">
            Zoom
            <NativeSelect aria-label="Zoom" value={zoom} onChange={(e) => zoomTo(Number(e.target.value))}>
              {[1, 2, 3, 4].map((z) => (
                <option key={z} value={z}>
                  {z}×
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-1 font-medium">
            Show a part's cut
            <NativeSelect aria-label="Show a part's cut" value={shown} onChange={(e) => setShown(e.target.value)}>
              <option value="">None</option>
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </NativeSelect>
          </label>
          <span className="text-muted-foreground" data-testid="region-state">
            {region ? `${points.length} points` : `${points.length} of at least 3 points`}
            {changed ? ", not saved" : saved ? ", saved" : ""}
          </span>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!changed || blocked !== null}
              onClick={() => onSave(region)}
              title={blocked ?? undefined}
            >
              {region || !saved ? "Save region" : "Remove region"}
              {recuttable > 0 ? ` and re-cut ${recuttable} parts` : ""}
            </Button>
            <Button size="sm" variant="outline" disabled={points.length === 0} onClick={() => setPoints([])}>
              Clear
            </Button>
            <Button size="sm" variant="outline" disabled={!changed} onClick={() => setPoints(saved ?? [])}>
              Undo changes
            </Button>
          </div>
          {blocked && <span className="text-muted-foreground">{blocked}</span>}
        </div>
      </div>
    </fieldset>
  );
}
