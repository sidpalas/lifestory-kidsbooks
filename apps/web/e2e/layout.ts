import { expect, type Locator } from "@playwright/test";

/**
 * The rows of a form grid whose cells are labels wrapping their control: per field, how tall its label text is and
 * where its control starts. A row's controls must start at one height even when one label wraps onto more lines.
 */
const fieldRows = (grid: Locator) =>
  grid.evaluate((el) => {
    const rows = new Map<number, { text: number; control: number }[]>();
    for (const label of el.querySelectorAll(":scope > label")) {
      const range = document.createRange();
      range.selectNode(label.firstChild!);
      const top = Math.round(label.getBoundingClientRect().top);
      const field = {
        text: Math.round(range.getBoundingClientRect().height),
        control: Math.round(label.querySelector("input, select")!.getBoundingClientRect().top),
      };
      rows.set(top, [...(rows.get(top) ?? []), field]);
    }
    return [...rows.values()];
  });

/**
 * Checks `box` fits inside its parent and nothing in it sticks out of its sides. A button that can't wrap, or a select
 * as wide as its longest option, pushes out of a card or widens it past its column often without the page scrolling
 * sideways, so a scrollWidth check misses it. What sits in a box that scrolls or clips sideways (a page strip) is left
 * to that box.
 */
export const expectContained = async (box: Locator) => {
  const outside = await box.evaluate((root) => {
    const found: string[] = [];
    const clips = (el: Element | null): boolean =>
      !!el && el !== root && (getComputedStyle(el).overflowX !== "visible" || clips(el.parentElement));
    const pairs: Array<[Element, Element]> = root.parentElement ? [[root, root.parentElement]] : [];
    for (const el of root.querySelectorAll("*")) if (!clips(el.parentElement)) pairs.push([el, root]);
    for (const [el, outer] of pairs) {
      const [inner, room] = [el.getBoundingClientRect(), outer.getBoundingClientRect()];
      if (inner.width > 0 && (inner.left < room.left - 1 || inner.right > room.right + 1))
        found.push(
          `${el === root ? "the box" : el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}"`,
        );
    }
    return found;
  });
  expect(outside, `inside ${Math.round((await box.boundingBox())!.width)} px`).toEqual([]);
};

/**
 * Checks the grid's fields line up row by row. `wraps` says a label in it should wrap at this width, so the check
 * covers the case it guards; `stacked` says the fields should be one per row (a phone).
 */
export const expectFieldsAligned = async (grid: Locator, { wraps = false, stacked = false } = {}) => {
  const rows = await fieldRows(grid);
  for (const row of rows) expect(new Set(row.map((field) => field.control)).size, JSON.stringify(rows)).toBe(1);
  if (wraps)
    expect(
      rows.some((row) => new Set(row.map((field) => field.text)).size > 1),
      `a label wraps: ${JSON.stringify(rows)}`,
    ).toBe(true);
  if (stacked) expect(rows.every((row) => row.length === 1)).toBe(true);
};
