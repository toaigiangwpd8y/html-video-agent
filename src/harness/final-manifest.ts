import type {RendererId} from "./renderer-selection.js";

export interface FinalRendererManifest {
  version:"1";
  renderer:RendererId;
  rendererVersion:string;
  projectId:string;
  revision:number;
  projectHash:string;
  productionProfileHash:string;
  assetManifestHash:string;
  sourceHash:string;
  width:number;
  height:number;
  fps:number;
  durationInFrames:number;
  durationSeconds:number;
  visualApproval:{status:"approved";approvedBy:"HUMAN";sourceHash:string;approvedAt:string};
  check:{command:string;passed:true};
  evidence:{index:string;files:string[]};
  output:{file:string;sha256:string;probe:Record<string,unknown>};
  implementationManifest:string;
}

/** Projects either renderer's completed manifest into the stable delivery schema. */
export function normalizeFinalManifest(source:Omit<FinalRendererManifest,"version"|"implementationManifest">,implementationManifest:string):FinalRendererManifest{
  return {version:"1",...source,implementationManifest};
}
