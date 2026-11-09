/** Normalized slide-deck source records written under `.video/sources/<deck-id>/`. */
export const DECK_SCHEMA="slide-deck-source/v1";
export const SLIDE_SCHEMA="slide-source/v1";

/** Bounds are in slide points (1/72 in) with the origin at the slide's top-left corner. */
export interface Bounds {x:number;y:number;width:number;height:number;}
export type TextRole="title"|"subtitle"|"body"|"footer"|"notes"|"other";

export interface TextParagraph {text:string;level:number;fontSizePt?:number;bold?:boolean;}
export interface TextBlock {
  id:string;role:TextRole;text:string;bounds?:Bounds;
  /** Largest / smallest font size (pt) observed inside the block, when known. */
  fontSizePt?:number;minFontSizePt?:number;bold?:boolean;color?:string;
  paragraphs?:TextParagraph[];
  /** PPTX only: shape name and placeholder type. */
  shapeName?:string;placeholder?:string;
  source:"pdf-text-layer"|"ooxml";
}
export interface ImageElement {
  id:string;
  /** Deck-relative path of the de-duplicated image file under images/. */
  asset:string;sha256:string;format:string;pixelWidth?:number;pixelHeight?:number;
  bounds?:Bounds;name?:string;description?:string;
  /** True when the same image appears on most slides (logo / template decoration). */
  chrome:boolean;
  /** True when the placed image is tiny (< 1.5% of the slide area): bullets, icons, underline art, diagram fragments. */
  decorative?:boolean;
  source:"pdf-embedded-image"|"ooxml-media";
}
export interface ShapeElement {id:string;kind:"shape"|"connector"|"group"|"table"|"chart"|"diagram"|"media"|"ole";name?:string;bounds?:Bounds;text?:string;asset?:string;detail?:unknown;}
export interface SlideMetrics {
  wordCount:number;textBlockCount:number;bodyWordCount:number;imageCount:number;contentImageCount:number;
  minFontSizePt?:number;maxFontSizePt?:number;
  /** Smallest text size in px when the whole slide is fit to a 1080 px tall frame. */
  minFontPxAt1080?:number;
  /** Fraction of the slide area covered by text blocks / non-chrome images (0..1, boxes may overlap). */
  textAreaRatio:number;imageAreaRatio:number;
}
export interface SlideRecord {
  schema:typeof SLIDE_SCHEMA;deckId:string;slide:number;id:string;title?:string;hidden?:boolean;
  size:{width:number;height:number;unit:"pt"};
  render?:{path:string;width:number;height:number;dpi:number};
  textPath:string;notesPath?:string;
  text:string;notes?:string;
  textBlocks:TextBlock[];images:ImageElement[];shapes:ShapeElement[];
  metrics:SlideMetrics;warnings:string[];
}
export interface DeckImage {id:string;path:string;sha256:string;format:string;pixelWidth?:number;pixelHeight?:number;slides:number[];chrome:boolean;bytes:number;}
export interface DeckIndex {
  schema:typeof DECK_SCHEMA;id:string;title:string;format:"pdf"|"pptx";
  source:{path:string;fileName:string;sha256:string;bytes:number};
  slideSize:{width:number;height:number;unit:"pt";aspectRatio:string};
  slideCount:number;renderDpi:number;tools:Record<string,string>;
  files:{deckText:string;renderedPdf?:string;contactSheets:string[]};
  slides:Array<{slide:number;id:string;title?:string;hidden?:boolean;render?:string;text:string;json:string;notes?:string;wordCount:number;imageCount:number;minFontPxAt1080?:number;warnings:number}>;
  images:DeckImage[];
  limitations:string[];warnings:string[];
}
