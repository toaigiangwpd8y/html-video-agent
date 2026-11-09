const REFERENCE_WIDTH = 1080;

/** RemotionUI's 1080px reference-width font scaling helper. */
export function scaleFont(
  sizeAt1080: number,
  width: number,
  referenceWidth = REFERENCE_WIDTH,
): number {
  return Math.round(sizeAt1080 * (width / referenceWidth));
}
