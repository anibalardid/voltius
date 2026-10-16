export interface CellMetrics {
  /** `.xterm-screen` bounding-rect origin in client coords. */
  left: number;
  top: number;
  cellWidth: number;
  cellHeight: number;
  cols: number;
  rows: number;
  /** Absolute buffer line at the top of the viewport (buffer.active.viewportY). */
  viewportTop: number;
}

export interface Cell {
  col: number;
  /** Absolute buffer line (viewportTop + row-in-view). */
  line: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Map a client (x, y) point to an absolute buffer cell, clamped to the grid. */
export function cellFromPoint(m: CellMetrics, x: number, y: number): Cell {
  const col = clamp(Math.floor((x - m.left) / m.cellWidth), 0, m.cols - 1);
  const row = clamp(Math.floor((y - m.top) / m.cellHeight), 0, m.rows - 1);
  return { col, line: m.viewportTop + row };
}

const isSpace = (ch: string | undefined) => !ch || /\s/.test(ch);

/** Maximal run of non-whitespace around `col`. Zero-length when `col` is whitespace/past end. */
export function wordRangeAt(lineText: string, col: number): { startCol: number; len: number } {
  if (isSpace(lineText[col])) return { startCol: col, len: 0 };
  let start = col;
  while (start > 0 && !isSpace(lineText[start - 1])) start -= 1;
  let end = col;
  while (end < lineText.length - 1 && !isSpace(lineText[end + 1])) end += 1;
  return { startCol: start, len: end - start + 1 };
}

/** A cell is "blank" when it is whitespace or past the end of the rendered line text. */
export function isBlankCell(lineText: string, col: number): boolean {
  return isSpace(lineText[col]);
}

/** Convert a pixel delta into whole scroll lines, carrying the sub-cell remainder. */
export function linesFromPixelDelta(
  dy: number,
  cellHeight: number,
  carry: number,
): { lines: number; carry: number } {
  const total = carry + dy / cellHeight;
  const lines = Math.trunc(total);
  return { lines, carry: total - lines };
}

export type Selection = { start: Cell; end: Cell };

const isBefore = (a: Cell, b: Cell) => a.line < b.line || (a.line === b.line && a.col < b.col);
const minCell = (a: Cell, b: Cell) => (isBefore(a, b) ? a : b);
const maxCell = (a: Cell, b: Cell) => (isBefore(a, b) ? b : a);

/** Extend a selection seeded by [anchorStart..anchorEnd] out to `focus`, char-precise across lines. */
export function extendSelection(anchorStart: Cell, anchorEnd: Cell, focus: Cell): Selection {
  return { start: minCell(anchorStart, focus), end: maxCell(anchorEnd, focus) };
}

/** Char count `term.select(col, row, length)` needs to cover [start..end] inclusive, given terminal width. */
export function selectionLength(start: Cell, end: Cell, cols: number): number {
  return (end.line - start.line) * cols + (end.col - start.col) + 1;
}

/** Client-coord point at a cell's left (colOffset 0) or right (colOffset 1) edge. */
export function cellPixel(m: CellMetrics, cell: Cell, colOffset: 0 | 1): { x: number; y: number } {
  return {
    x: m.left + (cell.col + colOffset) * m.cellWidth,
    y: m.top + (cell.line - m.viewportTop) * m.cellHeight,
  };
}

/** Distance between the first two touch points of a gesture. */
export function touchDistance(a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/**
 * Terminal font size for a pinch that started at `startDist` with `startSize`.
 * Scaling the size by the raw distance ratio makes the text track the fingers,
 * and rounding to whole pixels keeps xterm off fractional cell metrics.
 */
export type FingerSwipe =
  | { kind: "none" }
  | { kind: "scroll"; delta: number };

/**
 * One-finger drag always scrolls the viewport. It must never emit Up/Down:
 * at a shell prompt those keys recall command history, which is what a swipe
 * was doing on iOS. Full-screen apps still have the extra-key arrows.
 * `lines` is signed rows from the finger: positive = finger moved down.
 * Scroll delta is negated so a downward drag reveals older output, matching iOS.
 */
export function fingerSwipeAction(lines: number): FingerSwipe {
  if (lines === 0) return { kind: "none" };
  return { kind: "scroll", delta: -lines };
}

export interface ScrollbarThumb {
  /** Pixels from the top of the track. */
  offset: number;
  /** Thumb height in pixels. */
  size: number;
  /** Highest viewport-top line. 0 means the buffer fits on screen. */
  maxTop: number;
}

/** Thumb geometry for a browser-style terminal scrollbar. Null when the track has no height. */
export function scrollbarThumb(opts: {
  top: number;
  rows: number;
  length: number;
  track: number;
  minThumb: number;
}): ScrollbarThumb | null {
  if (opts.track <= 0 || opts.rows <= 0 || opts.length <= 0) return null;
  const maxTop = Math.max(0, opts.length - opts.rows);
  const size = maxTop === 0
    ? opts.track
    : Math.min(opts.track, Math.max(opts.minThumb, Math.round(opts.track * (opts.rows / opts.length))));
  const travel = Math.max(1, opts.track - size);
  const offset = maxTop === 0 ? 0 : Math.round((Math.max(0, Math.min(opts.top, maxTop)) / maxTop) * travel);
  return { offset, size, maxTop };
}

/** Viewport-top line for a pointer Y measured from the top of the track. */
export function scrollbarTopFromPointer(pointerY: number, track: number, thumb: number, maxTop: number): number {
  if (maxTop <= 0) return 0;
  const travel = Math.max(1, track - thumb);
  const y = Math.max(0, Math.min(pointerY - thumb / 2, travel));
  return Math.round((y / travel) * maxTop);
}

export function fontSizeFromPinch(
  startSize: number,
  startDist: number,
  dist: number,
  min: number,
  max: number,
): number {
  if (startDist <= 0) return startSize;
  return clamp(Math.round(startSize * (dist / startDist)), min, max);
}
