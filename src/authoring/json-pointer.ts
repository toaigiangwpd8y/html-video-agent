function escapePointerToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

function parseBracketedSegment(segment: string, original: string): string[] {
  if (segment.length === 0) throw new Error(`Invalid JSON path '${original}': empty segment.`);
  const tokens: string[] = [];
  const firstBracket = segment.indexOf("[");
  const base = firstBracket === -1 ? segment : segment.slice(0, firstBracket);
  if (base.length > 0) tokens.push(base);
  else if (firstBracket !== 0) throw new Error(`Invalid JSON path '${original}'.`);

  if (firstBracket === -1) return tokens;
  let cursor = firstBracket;
  while (cursor < segment.length) {
    if (segment[cursor] !== "[") throw new Error(`Invalid JSON path '${original}': malformed bracket notation.`);
    const close = segment.indexOf("]", cursor + 1);
    if (close === -1) throw new Error(`Invalid JSON path '${original}': unclosed bracket.`);
    const indexText = segment.slice(cursor + 1, close);
    if (!/^\d+$/.test(indexText)) throw new Error(`Invalid JSON path '${original}': bracket indices must be non-negative integers.`);
    tokens.push(String(Number(indexText)));
    cursor = close + 1;
  }
  return tokens;
}

function parseSlashPath(path: string): string[] {
  const rawSegments = path.split("/").slice(1);
  if (rawSegments.some((segment) => segment.length === 0)) {
    throw new Error(`Invalid JSON path '${path}': empty slash segment.`);
  }
  return rawSegments.flatMap((segment) => parseBracketedSegment(segment, path));
}

function parseDotPath(path: string): string[] {
  let source = path.trim();
  if (source.startsWith("$.")) source = source.slice(2);
  else if (source === "$") return [];
  else if (source.startsWith("$")) throw new Error(`Invalid JSON path '${path}'.`);
  if (!source) throw new Error(`Invalid JSON path '${path}'.`);

  const segments: string[] = [];
  let current = "";
  let bracketDepth = 0;
  for (const char of source) {
    if (char === "." && bracketDepth === 0) {
      if (!current) throw new Error(`Invalid JSON path '${path}': empty dot segment.`);
      segments.push(current);
      current = "";
      continue;
    }
    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth -= 1;
    if (bracketDepth < 0) throw new Error(`Invalid JSON path '${path}': unmatched closing bracket.`);
    current += char;
  }
  if (bracketDepth !== 0) throw new Error(`Invalid JSON path '${path}': unclosed bracket.`);
  if (!current) throw new Error(`Invalid JSON path '${path}': empty final segment.`);
  segments.push(current);
  return segments.flatMap((segment) => parseBracketedSegment(segment, path));
}

/**
 * Accepts canonical JSON Pointer plus the common LLM variants
 * `/brief/claims[0]/text` and `brief.claims[0].text`, and returns one
 * canonical RFC-6901-style pointer. Malformed bracket notation is rejected.
 */
export function normalizeJsonPointer(path: string): string {
  if (typeof path !== "string" || path.trim().length === 0) {
    throw new Error("JSON path must be a non-empty string.");
  }
  const trimmed = path.trim();
  const encodedTokens = trimmed.startsWith("/")
    ? parseSlashPath(trimmed)
    : parseDotPath(trimmed).map(escapePointerToken);
  return `/${encodedTokens.join("/")}`;
}

export function decodeJsonPointer(path: string): string[] {
  const normalized = normalizeJsonPointer(path);
  return normalized.split("/").slice(1).map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}

export function pointerIsWithin(path: string, prefix: string): boolean {
  const normalizedPath = normalizeJsonPointer(path);
  const normalizedPrefix = normalizeJsonPointer(prefix);
  return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
}
