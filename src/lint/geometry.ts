import type { LintRect } from "./types.js";

export const isFiniteRect = (r: LintRect | null | undefined): r is LintRect =>
  Boolean(r) && [r!.x, r!.y, r!.width, r!.height].every(Number.isFinite) && r!.width >= 0 && r!.height >= 0;

export function intersectionArea(a: LintRect, b: LintRect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

export function overlaps(a: LintRect, b: LintRect, tolerance = 0): boolean {
  return (
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > tolerance &&
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > tolerance
  );
}

/** Fraction of `inner` covered by `outer` (0..1). */
export function coveredFraction(inner: LintRect, outer: LintRect): number {
  const area = inner.width * inner.height;
  return area === 0 ? 0 : intersectionArea(inner, outer) / area;
}

/** Distance a point sits inside a rect; ≤0 means the point is outside or on the border. */
export function insideDepth(point: { x: number; y: number }, rect: LintRect): number {
  return Math.min(point.x - rect.x, rect.x + rect.width - point.x, point.y - rect.y, rect.y + rect.height - point.y);
}

/** Smallest rect covering every input; undefined for an empty list. */
export function unionRect(rects: LintRect[]): LintRect | undefined {
  if (!rects.length) return undefined;
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** True when one id is the other, or one is an ancestor of the other. Siblings under a shared parent are unrelated. */
export function sharesTree(
  elements: Map<string, { parentId?: string }>,
  candidateId: string,
  elementId: string,
): boolean {
  const ancestorOf = (ancestorId: string, descendantId: string): boolean => {
    for (let id = elements.get(descendantId)?.parentId; id; id = elements.get(id)?.parentId) if (id === ancestorId) return true;
    return false;
  };
  return candidateId === elementId || ancestorOf(candidateId, elementId) || ancestorOf(elementId, candidateId);
}

/** Approximate paint order: z-index dominates, document order breaks ties. */
export const paintOrder = (element: { zIndex: number; order: number }): number =>
  element.zIndex * 1_000_000_000 + element.order;
