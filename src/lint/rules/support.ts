import type { LintElement, LintFrame, LintRect } from "../types.js";

/** Text geometry: per-run client rects when measured, otherwise the element box. */
export const textRects = (element: LintElement): LintRect[] =>
  element.fragments?.length ? element.fragments : element.rect ? [element.rect] : [];

export const elementsById = (frame: LintFrame): Map<string, LintElement> =>
  new Map(frame.elements.map((element) => [element.id, element]));

/** Whitespace-collapsed comparison form for rendered and canonical copy. */
export const normalizeCopy = (value: string): string => value.replace(/\s+/g, " ").trim();

export const sceneIdsOf = (...elements: (LintElement | undefined)[]): string[] => [
  ...new Set(elements.flatMap((element) => (element?.sceneId ? [element.sceneId] : []))),
];
