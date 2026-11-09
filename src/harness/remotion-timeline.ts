import type {VideoProject} from "../core/types.js";

export interface TimelineSceneInterval {sceneId:string;startFrame:number;endFrame:number;}
/**
 * Renderer-owned resolved timing evidence. This is an output of Remotion planning,
 * not a compiler input and not a transition DSL. Scene intervals may overlap.
 */
export interface RemotionTimelineEvidence {version:"3";fps:number;durationInFrames:number;scenes:TimelineSceneInterval[];}
export interface TimelineDiagnostic {path:string;code:string;message:string;}
export interface TimelineValidationResult {valid:boolean;diagnostics:TimelineDiagnostic[];timeline?:RemotionTimelineEvidence;}
const diag=(path:string,code:string,message:string):TimelineDiagnostic=>({path,code,message});
const isInt=(v:unknown):v is number=>typeof v==="number"&&Number.isInteger(v);

export async function validateRemotionTimeline(raw:unknown,project:VideoProject,_generatedRoot?:string):Promise<TimelineValidationResult>{
  const diagnostics:TimelineDiagnostic[]=[];
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return {valid:false,diagnostics:[diag("/timeline","TIMELINE_INVALID","timeline.json must be an object.")]};
  const t=raw as Record<string,unknown>;
  if(t.version!=="3")diagnostics.push(diag("/timeline/version","TIMELINE_VERSION","version must be \"3\". V3 is renderer-owned resolved timing evidence and permits overlapping scene occupancy."));
  if(t.fps!==project.meta.fps)diagnostics.push(diag("/timeline/fps","TIMELINE_FPS",`fps must match VideoProject meta.fps ${project.meta.fps}.`));
  const expectedFrames=project.meta.durationsInFrames;
  if(t.durationInFrames!==expectedFrames)diagnostics.push(diag("/timeline/durationInFrames","TIMELINE_DURATION",`Expected ${expectedFrames} frames from VideoProject meta.durationsInFrames, got ${String(t.durationInFrames)}.`));

  const scenes=Array.isArray(t.scenes)?t.scenes:[];
  if(!Array.isArray(t.scenes))diagnostics.push(diag("/timeline/scenes","TIMELINE_SCENES","scenes must be an array."));
  const parsed:TimelineSceneInterval[]=[];
  for(let i=0;i<scenes.length;i++){
    const s=scenes[i] as any;
    if(!s||typeof s!=="object"){diagnostics.push(diag(`/timeline/scenes/${i}`,"TIMELINE_SCENE_INVALID","Scene interval must be an object."));continue;}
    if(typeof s.sceneId!=="string")diagnostics.push(diag(`/timeline/scenes/${i}/sceneId`,"TIMELINE_SCENE_ID","sceneId must be a string."));
    if(!isInt(s.startFrame)||s.startFrame<0)diagnostics.push(diag(`/timeline/scenes/${i}/startFrame`,"TIMELINE_FRAME","startFrame must be a non-negative integer."));
    if(!isInt(s.endFrame)||!isInt(s.startFrame)||s.endFrame<=s.startFrame)diagnostics.push(diag(`/timeline/scenes/${i}/endFrame`,"TIMELINE_FRAME","endFrame must be an integer greater than startFrame."));
    if(typeof s.sceneId==="string"&&isInt(s.startFrame)&&isInt(s.endFrame)&&s.endFrame>s.startFrame)parsed.push({sceneId:s.sceneId,startFrame:s.startFrame,endFrame:s.endFrame});
  }

  const projectIds=project.scenes.map(s=>s.id),timelineIds=parsed.map(s=>s.sceneId);
  if(projectIds.length!==timelineIds.length||projectIds.some((id,i)=>timelineIds[i]!==id))diagnostics.push(diag("/timeline/scenes","TIMELINE_SCENE_ORDER",`Timeline scene IDs must exactly match VideoProject order: ${projectIds.join(", ")}.`));
  for(let i=1;i<parsed.length;i++)if(parsed[i].startFrame<parsed[i-1].startFrame)diagnostics.push(diag(`/timeline/scenes/${i}/startFrame`,"TIMELINE_START_ORDER","Scene start frames must be non-decreasing in VideoProject order. Overlap is allowed; reordering is not."));

  if(parsed.length){
    const sorted=[...parsed].sort((a,b)=>a.startFrame-b.startFrame||a.endFrame-b.endFrame);
    let coveredUntil=0;
    if(sorted[0].startFrame!==0)diagnostics.push(diag("/timeline/scenes/0/startFrame","TIMELINE_START","Rendered scene coverage must start at frame 0."));
    for(const s of sorted){
      if(s.startFrame>coveredUntil)diagnostics.push(diag("/timeline/scenes","TIMELINE_GAP",`Uncovered frames ${coveredUntil}..${s.startFrame-1}. Scene overlap is allowed; gaps are not.`));
      coveredUntil=Math.max(coveredUntil,s.endFrame);
      if(s.endFrame>expectedFrames)diagnostics.push(diag("/timeline/scenes","TIMELINE_OVERFLOW",`Scene ${s.sceneId} ends at ${s.endFrame}, beyond deliverable frame ${expectedFrames}.`));
    }
    if(coveredUntil!==expectedFrames)diagnostics.push(diag("/timeline/scenes","TIMELINE_END",`Rendered scene coverage ends at frame ${coveredUntil}; expected exactly ${expectedFrames}.`));
  } else diagnostics.push(diag("/timeline/scenes","TIMELINE_EMPTY","At least one scene interval is required."));

  return {valid:diagnostics.length===0,diagnostics,timeline:raw as RemotionTimelineEvidence};
}
