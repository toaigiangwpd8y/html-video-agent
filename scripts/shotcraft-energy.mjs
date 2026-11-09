export function energyBandFromText(value) {
  const descriptor = String(value ?? "").split(/[（(]/, 1)[0].replace(/\s/g, "");
  if (!descriptor || /^(n\/a|na|unknown)$/i.test(descriptor)) return "unknown";
  const english = descriptor.toLowerCase().replace(/-/g, "_");
  if (["high", "veryhigh", "medium_high", "low_to_high", "low_medium_high"].includes(english)) return "high";
  if (["medium", "low_medium"].includes(english)) return english;
  if (english === "low") return "low";
  if (/(极高|高|峰值)/.test(descriptor)) return "high";
  if (/低/.test(descriptor) && /中/.test(descriptor)) return "low_medium";
  if (/低/.test(descriptor)) return "low";
  if (/中/.test(descriptor)) return "medium";
  return "unknown";
}
