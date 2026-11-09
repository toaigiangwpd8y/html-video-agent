import type {Browser, BrowserContext, Locator, Page} from "playwright-core";

export interface Viewport {width:number;height:number;}

export interface CaptureServerConfig {
  command:string;
  args:string[];
  cwd:string;
  healthUrl:string;
  startTimeoutMs?:number;
}

export interface CaptureAppConfig {
  url:string;
  session?:{handle:string;networkPolicy:"capture"|"strict"};
  allowedHosts?:string[];
  browserExecutablePath?:string;
  viewport?:Viewport;
  dpr?:number;
  fps?:number;
  clock?:boolean;
  headless?:boolean;
  navigationTimeoutMs?:number;
  actionTimeoutMs?:number;
  maxFrames?:number;
  maxDurationSeconds?:number;
  maxArtifactBytes?:number;
  maxRunBytes?:number;
  server?:CaptureServerConfig;
  auth?:{storageStatePath?:string};
  identity?:{required?:boolean;account?:{target:LocatorSpec;text:string;exact?:boolean};role?:{target:LocatorSpec;text:string;exact?:boolean}};
}

export type LocatorSpec = {
  role?:string;
  name?:string;
  text?:string;
  testId?:string;
  css?:string;
  exact?:boolean;
  first?:boolean;
  index?:number;
  within?:LocatorSpec;
};

interface StepBase {timeoutMs?:number;optional?:boolean;}
export type CaptureStep =
  | (StepBase & {action:"goto";url:string})
  | (StepBase & {action:"back";holdFrames?:number})
  | (StepBase & {action:"waitFor";target:LocatorSpec;state?:"visible"|"hidden"|"attached"|"detached"})
  | (StepBase & {action:"assertVisible";target:LocatorSpec})
  | (StepBase & {action:"assertText";target:LocatorSpec;text:string;exact?:boolean})
  | (StepBase & {action:"hover";target:LocatorSpec;travelFrames?:number;holdFrames?:number})
  | (StepBase & {action:"click";target:LocatorSpec;travelFrames?:number;holdFrames?:number})
  | (StepBase & {action:"fill";target:LocatorSpec;value:string|{env:string};travelFrames?:number;holdFrames?:number})
  | (StepBase & {action:"press";key:string;target?:LocatorSpec;travelFrames?:number;holdFrames?:number})
  | (StepBase & {action:"scroll";deltaY:number;frames?:number;target?:LocatorSpec})
  | (StepBase & {action:"hold";frames:number})
  | (StepBase & {action:"marker";name:string})
  | (StepBase & {action:"screenshot";name:string;mode?:"viewport"|"fullPage"|"element";target?:LocatorSpec});

export interface CaptureRecipe {
  version:"1";
  name:string;
  app:CaptureAppConfig;
  steps:CaptureStep[];
  outputs:{video?:boolean;cursorOverlay?:boolean};
  postconditions?:Array<
    | {action:"assertVisible";target:LocatorSpec;timeoutMs?:number}
    | {action:"assertText";target:LocatorSpec;text:string;exact?:boolean;timeoutMs?:number}
  >;
}

export type CaptureArtifactType="image/png"|"video/mp4";
export interface CaptureArtifact {
  id:string;
  type:CaptureArtifactType;
  file:string;
  width:number;
  height:number;
  sizeBytes:number;
  sha256:string;
  frames?:number;
  fps?:number;
  durationSeconds?:number;
}

export interface CaptureTimeline {
  version:"1";
  fps:number;
  viewport:Viewport;
  deviceScaleFactor:number;
  sourceWidth:number;
  sourceHeight:number;
  outputWidth:number;
  outputHeight:number;
  frames:number;
  durationSeconds:number;
  clock:"enabled"|"disabled";
  cameraKeys:Array<{frame:number;scale:number;fx:number;fy:number}>;
  cursorKeys:Array<{frame:number;x:number;y:number}>;
  clicks:Array<{frame:number;x:number;y:number}>;
  markers:Array<{frame:number;name:string}>;
  limitations:string[];
  borrowedViewport?:{before:Viewport;after:Viewport;restored:boolean};
}

export interface SkippedStep {
  index:number;
  action:string;
  reason:string;
  target?:LocatorSpec;
  name?:string;
}

export interface CaptureRunResult {
  version:"1";
  id:string;
  status:"succeeded"|"failed";
  createdAt:string;
  recipeHash:string;
  config:Record<string,unknown>;
  outputs?:{video:boolean;cursorOverlay:boolean};
  artifacts:CaptureArtifact[];
  postconditions:Array<{index:number;passed:boolean;action:string}>;
  timeline?:CaptureTimeline;
  error?:{code:string;message:string;stepIndex?:number;action?:string};
  skippedSteps?:SkippedStep[];
  executedInteractions?:number;
  finalUrl?:string;
  authGated?:boolean;
  session?:{ownership:"owned"|"borrowed";appId?:string;contextId?:string;role?:string;viewport?:Viewport;deviceScaleFactor?:number;borrowedViewport?:{before:Viewport;after:Viewport;restored:boolean}};
}

export class WebCaptureError extends Error {
  constructor(public readonly code:string,message:string,public readonly stepIndex?:number,public readonly action?:string){super(message);this.name="WebCaptureError";}
}

export interface CaptureSession {
  browser:Browser;
  context:BrowserContext;
  page:Page;
  clockEnabled:boolean;
  ownership:"owned"|"borrowed";
  viewport:Viewport;
  deviceScaleFactor:number;
  sessionBinding?:{appId:string;contextId:string;role:string};
  borrowedViewport?:{before:Viewport;after:Viewport};
  borrowedViewportRestored?:()=>boolean;
  assertPolicy?:()=>void;
  securePage?:(page:Page)=>Promise<void>;
  close():Promise<void>;
}

export interface CaptureDirector {
  readonly frame:number;
  readonly frameBytes:number;
  setPage(page:Page):void;
  shot():Promise<void>;
  hold(frames:number):Promise<void>;
  moveTo(locator:Locator,frames?:number):Promise<{x:number;y:number}>;
  scroll(deltaY:number,frames:number):Promise<void>;
  marker(name:string):void;
  click(x:number,y:number):void;
  timeline(sourceWidth:number,sourceHeight:number,outputWidth:number,outputHeight:number,cursorOverlay?:boolean):CaptureTimeline;
}
