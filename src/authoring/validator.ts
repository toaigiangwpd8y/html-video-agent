import type {ValidationIssue, ValidationReport, VideoProject} from "../core/types.js";

function issue(code:string,severity:"error"|"warning",message:string,targetId?:string,details?:Record<string,unknown>):ValidationIssue{return {code,severity,message,...(targetId?{targetId}:{}),...(details?{details}:{})};}
function rec(v:unknown):v is Record<string,unknown>{return typeof v==="object"&&v!==null&&!Array.isArray(v);}
function nonempty(v:unknown):v is string{return typeof v==="string"&&v.trim().length>0;}
function positiveInt(v:unknown):v is number{return typeof v==="number"&&Number.isInteger(v)&&v>0;}
function rejectUnknown(value:Record<string,unknown>,allowed:string[],path:string,issues:ValidationIssue[]):void{const ok=new Set(allowed);for(const key of Object.keys(value))if(!ok.has(key))issues.push(issue("FIELD_UNKNOWN","error",`${path}/${key} is not part of the canonical VideoProject contract.`,undefined,{path:`${path}/${key}`}));}
function strings(v:unknown,path:string,issues:ValidationIssue[],allowEmpty=true):string[]{if(!Array.isArray(v)){issues.push(issue("FIELD_ARRAY_REQUIRED","error",`${path} must be an array of strings.`,undefined,{path}));return [];}const out:string[]=[];v.forEach((x,i)=>{if(typeof x!=="string"||(!allowEmpty&&!x.trim()))issues.push(issue("ARRAY_STRING_ITEM_REQUIRED","error",`${path}/${i} must be a non-empty string.`,undefined,{path:`${path}/${i}`}));else out.push(x);});return out;}
export async function validateProject(input:unknown):Promise<ValidationReport>{
  const issues:ValidationIssue[]=[];
  if(!rec(input))return {valid:false,issues:[issue("PROJECT_OBJECT_REQUIRED","error","VideoProject candidate must be an object.")]};
  rejectUnknown(input,["meta","scenes"],"",issues);

  const meta=rec(input.meta)?input.meta:null;
  if(!meta)issues.push(issue("META_REQUIRED","error","/meta must be an object."));
  else {
    rejectUnknown(meta,["title","width","height","durationsInFrames","fps","theme","constraints"],"/meta",issues);
    if(!nonempty(meta.title))issues.push(issue("TITLE_REQUIRED","error","/meta/title must be a non-empty string."));
    for(const key of ["width","height","durationsInFrames","fps"] as const)if(!positiveInt(meta[key]))issues.push(issue(`META_${key.toUpperCase()}_INVALID`,"error",`/meta/${key} must be an integer > 0.`));
    const theme=rec(meta.theme)?meta.theme:null;
    if(!theme)issues.push(issue("THEME_REQUIRED","error","/meta/theme must be an object."));
    else {
      rejectUnknown(theme,["palette","font","mode","roles"],"/meta/theme",issues);
      const palette=strings(theme.palette,"/meta/theme/palette",issues,false);
      if(palette.length===0)issues.push(issue("PALETTE_REQUIRED","error","/meta/theme/palette must contain at least one color."));
      palette.forEach((color,i)=>{if(!/^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/.test(color))issues.push(issue("PALETTE_COLOR_INVALID","error",`/meta/theme/palette/${i} must be a 6- or 8-digit hex color.`));});
      if(new Set(palette).size!==palette.length)issues.push(issue("PALETTE_DUPLICATE","error","/meta/theme/palette must not contain duplicate colors."));
      if(!nonempty(theme.font))issues.push(issue("FONT_REQUIRED","error","/meta/theme/font must be a non-empty string."));
      if(theme.mode!==undefined&&theme.mode!=="dark"&&theme.mode!=="light")issues.push(issue("THEME_MODE_INVALID","error","/meta/theme/mode must be 'dark' or 'light'."));
      if(theme.roles!==undefined){
        if(!rec(theme.roles))issues.push(issue("THEME_ROLES_INVALID","error","/meta/theme/roles must be an object."));
        else {
          rejectUnknown(theme.roles,["page","text","accent"],"/meta/theme/roles",issues);
          const members=new Set(palette.map(color=>color.toUpperCase()));const pinned:string[]=[];
          for(const role of ["page","text","accent"] as const){const value=theme.roles[role];if(value===undefined)continue;
            if(typeof value!=="string"||!members.has(value.toUpperCase()))issues.push(issue("THEME_ROLE_NOT_IN_PALETTE","error",`/meta/theme/roles/${role} must be a color from /meta/theme/palette.`));
            else pinned.push(value.toUpperCase());}
          if(new Set(pinned).size!==pinned.length)issues.push(issue("THEME_ROLE_DUPLICATE","error","/meta/theme/roles must pin page, text, and accent to distinct palette colors."));
        }
      }
    }
    const constraints=rec(meta.constraints)?meta.constraints:null;
    if(!constraints)issues.push(issue("CONSTRAINTS_REQUIRED","error","/meta/constraints must be an object."));
    else {
      rejectUnknown(constraints,["style","disallowed","motionTone"],"/meta/constraints",issues);
      if(!nonempty(constraints.style))issues.push(issue("CONSTRAINT_STYLE_REQUIRED","error","/meta/constraints/style must be a non-empty string."));
      strings(constraints.disallowed,"/meta/constraints/disallowed",issues,false);
      if(!nonempty(constraints.motionTone))issues.push(issue("CONSTRAINT_MOTION_TONE_REQUIRED","error","/meta/constraints/motionTone must be a non-empty string."));
    }
  }

  const scenes=Array.isArray(input.scenes)?input.scenes:[];
  if(!Array.isArray(input.scenes)||scenes.length===0)issues.push(issue("SCENES_REQUIRED","error","/scenes must contain at least one scene."));
  const seen=new Set<string>();let sceneFrames=0;
  scenes.forEach((value,i)=>{
    const base=`/scenes/${i}`;
    if(!rec(value)){issues.push(issue("SCENE_OBJECT_REQUIRED","error",`${base} must be an object.`));return;}
    const s=value;
    rejectUnknown(s,["id","durationInFrames","audio","screenText","visualConcept"],base,issues);
    if(!nonempty(s.id))issues.push(issue("SCENE_ID_REQUIRED","error",`${base}/id must be a non-empty string.`));
    else if(seen.has(s.id))issues.push(issue("SCENE_ID_DUPLICATE","error",`Duplicate scene id '${s.id}'.`,s.id,{path:`${base}/id`}));
    else seen.add(s.id);
    if(!positiveInt(s.durationInFrames))issues.push(issue("SCENE_DURATION_INVALID","error",`${base}/durationInFrames must be an integer > 0.`,String(s.id??"")));
    else sceneFrames+=s.durationInFrames;
    if(!nonempty(s.screenText))issues.push(issue("SCENE_SCREEN_TEXT_REQUIRED","error",`${base}/screenText must be meaningful viewer-facing copy.`,String(s.id??"")));
    if(!nonempty(s.visualConcept))issues.push(issue("SCENE_VISUAL_CONCEPT_REQUIRED","error",`${base}/visualConcept must be a non-empty semantic visual description.`,String(s.id??"")));
    if(s.audio!==undefined){
      if(!rec(s.audio))issues.push(issue("SCENE_AUDIO_INVALID","error",`${base}/audio must be an object when present.`,String(s.id??"")));
      else {
        rejectUnknown(s.audio,["voiceoverText","voiceSegmentId"],`${base}/audio`,issues);
        if(!nonempty(s.audio.voiceoverText))issues.push(issue("VOICEOVER_TEXT_REQUIRED","error",`${base}/audio/voiceoverText must be non-empty.`,String(s.id??"")));
        if(s.audio.voiceSegmentId!==undefined&&!nonempty(s.audio.voiceSegmentId))issues.push(issue("VOICEOVER_SEGMENT_ID_INVALID","error",`${base}/audio/voiceSegmentId must be a non-empty stable TTS segment ID.`,String(s.id??"")));
      }
    }
  });
  if(meta&&positiveInt(meta.durationsInFrames)&&sceneFrames!==meta.durationsInFrames)issues.push(issue("SCENE_DURATION_SUM_MISMATCH","error",`Scene durationInFrames sum is ${sceneFrames}; expected meta.durationsInFrames ${meta.durationsInFrames}.`,undefined,{path:"/scenes"}));
  return {valid:!issues.some(x=>x.severity==="error"),issues};
}

export function asVideoProject(value:unknown):VideoProject{return value as VideoProject;}
