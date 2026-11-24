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
