export interface AudioAssetTiming {
  startFrame?: number;
  durationInFrames?: number;
  mediaStartSeconds?: number;
  gain?: number;
  fadeInInFrames?: number;
  fadeOutInFrames?: number;
}

export interface ExplorerAssetOrigin {
  appId:string;
  knowledgeRevision:string;
  contextId:string;
  featureId:string;
  scenarioId:string;
  executionId:string;
  evidenceRef:string;
  sha256:string;
}

export function isValidExplorerAssetOrigin(value:unknown):value is ExplorerAssetOrigin {
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const origin=value as Record<string,unknown>;
  return ["appId","contextId","featureId","scenarioId","executionId","evidenceRef"].every((key)=>typeof origin[key]==="string"&&(origin[key] as string).trim().length>0)&&
    typeof origin.knowledgeRevision==="string"&&/^r\d{6,}$/.test(origin.knowledgeRevision)&&typeof origin.sha256==="string"&&/^sha256:[a-f0-9]{64}$/.test(origin.sha256);
}

export interface AssetManifestItem {
  id: string;
  publicPath: string;
  type: string;
  source?: string;
  sourceUrl?: string;
  provenance?: string;
  license?: string;
  rights?: string;
  permittedUse?: string;
  sceneIds?: string[];
  role?: string;
  derivedFrom?: string;
  width?: number;
  height?: number;
  hasAlpha?: boolean;
  notes?: string;
  audioTiming?: AudioAssetTiming;
  family?: string;
  weight?: string;
  style?: string;
  researchEvidence?:ExplorerAssetOrigin;
}

export interface AssetManifest {
  version: string;
  assets: AssetManifestItem[];
}
