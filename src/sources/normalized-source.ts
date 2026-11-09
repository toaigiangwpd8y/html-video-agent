export type NormalizedSourceKind="presentation"|"document"|"image"|"url"|"text"|"existing_asset";
export type SourceElementType="text"|"image"|"shape"|"group"|"connector"|"table"|"chart"|"diagram"|"unknown";
export type SourceRewritePolicy="preserve"|"light";
export interface SourceNarration {text:string;path?:string;rewritePolicy?:SourceRewritePolicy;}

export interface SourceBBox {x:number;y:number;width:number;height:number;}
export interface SourceAsset {id:string;path:string;type?:string;width?:number;height?:number;metadata?:Record<string,unknown>;}
export interface SourceElement {
  id:string;
  type:SourceElementType;
  text?:string;
  textList?:string[];
  assetRef?:string;
  bbox?:SourceBBox;
  zIndex?:number;
  children?:SourceElement[];
  relations?:Array<{id?:string;sourceId?:string;targetId?:string;type?:string}>;
  metadata?:Record<string,unknown>;
}
export interface SourceSection {id:string;label?:string;text?:string;textPath?:string;elementIds?:string[];narration?:SourceNarration;metadata?:Record<string,unknown>;}
export interface NormalizedSource {
  id:string;kind:NormalizedSourceKind;title?:string;text?:string;sections?:SourceSection[];elements?:SourceElement[];assets?:SourceAsset[];
  /** @deprecated Prefer narration bound to each slide/page section. */
  narration?:SourceNarration;
  metadata?:Record<string,unknown>;
}
export interface SourceIndexEntry {id:string;kind:NormalizedSourceKind;path:string;}
export interface SourceIndex {version:"1";sources:SourceIndexEntry[];}
