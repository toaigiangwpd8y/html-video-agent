/** RemotionUI's compact chart-number formatting helper. */
export function formatCompactNumber(
  value: number,
  maximumFractionDigits = 1,
): string {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits,
  }).format(value);
}
