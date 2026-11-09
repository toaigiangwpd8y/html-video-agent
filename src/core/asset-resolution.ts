export interface SceneAssetReference {
  id: string;
  publicPath: string;
  type: string;
  sceneIds?: string[];
  role?: string;
}

export type SceneAssetResolutionCode = "MISSING" | "AMBIGUOUS";

export class SceneAssetResolutionError extends Error {
  constructor(
    public readonly code: SceneAssetResolutionCode,
    public readonly sceneId: string,
    public readonly role: string,
    message: string,
  ) {
    super(message);
    this.name = "SceneAssetResolutionError";
  }
}

function usablePublicPath(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("/assets/") || value.includes("\\") || value.includes("\0")) return false;
  const segments = value.slice("/assets/".length).split("/");
  return segments.length > 0 && segments.every((segment) => Boolean(segment) && segment !== "." && segment !== "..");
}

function usableForRole(asset: SceneAssetReference, role: string): boolean {
  return Boolean(asset.id && asset.type && usablePublicPath(asset.publicPath)) &&
    (role !== "voiceover" || asset.type.toLowerCase().startsWith("audio/"));
}

/** Resolve one renderer-safe production asset from the existing scene-bound manifest. */
export function resolveSceneAsset(sceneId: string, role: string, assets: SceneAssetReference[]): string {
  const candidates = assets.filter((asset) => asset.role === role && asset.sceneIds?.includes(sceneId));
  if (candidates.length > 1) {
    throw new SceneAssetResolutionError(
      "AMBIGUOUS",
      sceneId,
      role,
      `Ambiguous asset binding for scene '${sceneId}' with role '${role}'; exactly one usable asset is required.`,
    );
  }
  const usable = candidates.filter((asset) => usableForRole(asset, role));
  if (usable.length === 0) {
    throw new SceneAssetResolutionError(
      "MISSING",
      sceneId,
      role,
      `No usable asset is registered for scene '${sceneId}' with role '${role}'.`,
    );
  }
  return usable[0].publicPath;
}

export function resolveSceneVoiceover(sceneId: string, assets: SceneAssetReference[]): string {
  return resolveSceneAsset(sceneId, "voiceover", assets);
}
