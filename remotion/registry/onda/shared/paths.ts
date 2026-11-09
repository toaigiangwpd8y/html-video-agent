// Compatibility closure for Onda callout's straight SVG line.
// This preserves @remotion/paths evolvePath output without adding that package.
export function evolveLine(progress: number, startX: number, startY: number, endX: number, endY: number): {strokeDasharray: string; strokeDashoffset: number} {
  const length = Math.hypot(endX - startX, endY - startY);
  if (progress === 0) {
    const extendedLength = length * 1.5;
    return {
      strokeDasharray: `${extendedLength} ${extendedLength}`,
      strokeDashoffset: extendedLength,
    };
  }
  return {
    strokeDasharray: `${length} ${length}`,
    strokeDashoffset: length - progress * length,
  };
}
