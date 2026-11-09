export const COMPATIBILITY_STATUSES = Object.freeze(["source_only", "smoke_passed", "blocked"]);

const isRecord = value => typeof value === "object" && value !== null && !Array.isArray(value);

export function classifyRenderedPair({original, adapted}) {
  const evidence = [...new Set([...(original?.evidence ?? []), ...(adapted?.evidence ?? [])])];
  const runtimeVersion = original?.runtimeVersion ?? adapted?.runtimeVersion ?? null;
  const blocked = reason => ({status: "blocked", reason, evidence, runtimeVersion});

  if (original?.renderStatus !== "rendered" || adapted?.renderStatus !== "rendered") {
    return blocked("At least one original/adapted render did not complete successfully.");
  }
  if (typeof original.runtimeVersion !== "string" || original.runtimeVersion !== adapted.runtimeVersion) {
    return blocked("Original and adapted renders do not record the same Remotion runtimeVersion.");
  }

  const originalFrames = original.stillHashes;
  const adaptedFrames = adapted.stillHashes;
  if (!isRecord(originalFrames) || !isRecord(adaptedFrames)) {
    return blocked("Still-frame SHA-256 evidence is missing.");
  }
  const frames = Object.keys(originalFrames).sort((a, b) => Number(a) - Number(b));
  if (!frames.length || frames.length !== Object.keys(adaptedFrames).length || frames.some(frame => !(frame in adaptedFrames))) {
    return blocked("Original/adapted still checkpoint sets differ or are empty.");
  }
  const mismatchedFrame = frames.find(frame => originalFrames[frame] !== adaptedFrames[frame]);
  if (mismatchedFrame !== undefined) return blocked(`Still frame ${mismatchedFrame} SHA-256 hash mismatch.`);
  if (typeof original.clipHash !== "string" || !original.clipHash || typeof adapted.clipHash !== "string" || !adapted.clipHash) {
    return blocked("Original/adapted clip SHA-256 evidence is missing.");
  }
  if (original.clipHash !== adapted.clipHash) return blocked("Original/adapted clip SHA-256 hash mismatch.");

  return {status: "smoke_passed", reason: "All paired still and motion-clip SHA-256 hashes match.", evidence, runtimeVersion: original.runtimeVersion};
}

export function buildCompatibilityLedger(catalog, evidence) {
  if (!Array.isArray(catalog?.cards) || !Array.isArray(evidence)) throw new Error("A catalog and compatibility evidence array are required.");
  const byVariant = new Map();
  for (const proof of evidence) {
    if (!isRecord(proof) || typeof proof.variantId !== "string") throw new Error("Each compatibility proof requires variantId.");
    if (byVariant.has(proof.variantId)) throw new Error(`Duplicate compatibility evidence for variant '${proof.variantId}'.`);
    if (!COMPATIBILITY_STATUSES.includes(proof.status)) throw new Error(`Unsupported compatibility status '${String(proof.status)}'.`);
    if (typeof proof.reason !== "string" || !proof.reason.trim()) throw new Error(`Compatibility evidence for '${proof.variantId}' requires a non-empty reason.`);
    if (!Array.isArray(proof.evidence)) throw new Error(`Compatibility evidence for '${proof.variantId}' requires an evidence array.`);
    if (!(typeof proof.runtimeVersion === "string" || proof.runtimeVersion === null)) throw new Error(`Compatibility evidence for '${proof.variantId}' requires runtimeVersion as a string or null.`);
    if (proof.status === "smoke_passed" && (!proof.runtimeVersion || !proof.evidence.length)) throw new Error(`smoke_passed variant '${proof.variantId}' requires runtimeVersion and at least one evidence reference.`);
    byVariant.set(proof.variantId, proof);
  }

  const items = catalog.cards.flatMap(card => card.variants.map(variant => {
    const proof = byVariant.get(variant.id);
    return {
      cardId: card.id,
      variantId: variant.id,
      category: card.category,
      demo: variant.source.demo,
      closure: variant.source.closure,
      status: proof?.status ?? "source_only",
      reason: proof?.reason ?? "No per-item smoke render was recorded.",
      evidence: proof?.evidence ?? [],
      runtimeVersion: proof?.runtimeVersion ?? null,
    };
  }));
  const knownVariants = new Set(items.map(item => item.variantId));
  for (const variantId of byVariant.keys()) if (!knownVariants.has(variantId)) throw new Error(`Compatibility evidence references unknown catalog variant '${variantId}'.`);
  const counts = Object.fromEntries(COMPATIBILITY_STATUSES.map(status => [status, items.filter(item => item.status === status).length]));
  return {denominator: items.length, counts, items};
}
