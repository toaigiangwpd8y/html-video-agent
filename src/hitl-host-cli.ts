import {resolve} from "node:path";
import {resolveClarification} from "./harness/clarification.js";
import {selectRenderer,type RendererId} from "./harness/renderer-selection.js";
import {approveSelectedRendererReview} from "./harness/renderer.js";
import {approveScriptReview,approveStoryboardReview,approveVideoBrief} from "./harness/preproduction-hitl.js";
import {approveProductionAssetPreflight} from "./harness/production-preflight-hitl.js";
import {assertActiveHitlCheckpoint,universalHitlStatus} from "./harness/hitl-protocol.js";
import {reopenCheckpoint,type ReopenCheckpoint} from "./harness/reopen.js";
import {chooseDurationAction} from "./harness/duration-decision.js";

const root=process.cwd();
const print=(value:unknown)=>console.log(JSON.stringify(value,null,2));

async function main(){
  const [area,action,...args]=process.argv.slice(2);

  if(area==="status"){
    print(await universalHitlStatus(root));
    return;
  }

  if(area==="clarify"&&action==="resolve"){
    const file=args[0];
    if(!file)throw new Error("Usage: video:host -- clarify resolve <answers.json>");
    await assertActiveHitlCheckpoint(root,"CLARIFICATION","INPUT_REQUIRED","needs_user_input");
    print({ok:true,...await resolveClarification(root,resolve(root,file))});
    return;
  }

  if(area==="brief"&&action==="approve"){
    const renderer=args[0] as RendererId|undefined;
    if(!renderer)throw new Error("Choose a renderer explicitly. Usage: video:host -- brief approve <remotion|hyperframes>");
    await assertActiveHitlCheckpoint(root,"VIDEO_BRIEF","REVIEW_REQUIRED","needs_brief_review");
    print({ok:true,...await approveVideoBrief(root,"HUMAN",renderer)});
    return;
  }

  if(area==="renderer"&&action==="select"){
    const renderer=args[0] as RendererId|undefined;
    if(!renderer)throw new Error("Usage: video:host -- renderer select <remotion|hyperframes>");
    await assertActiveHitlCheckpoint(root,"RENDERER_SELECTION","INPUT_REQUIRED","needs_renderer_selection");
    print({ok:true,selection:await selectRenderer(root,renderer,"Explicitly selected by the human after reviewing the renderer comparison for this brief.")});
    return;
  }

  if(area==="script"&&action==="approve"){
    await assertActiveHitlCheckpoint(root,"SCRIPT","REVIEW_REQUIRED","needs_script_review");
    print({ok:true,review:await approveScriptReview(root,"HUMAN")});
    return;
  }

  if(area==="storyboard"&&action==="approve"){
    await assertActiveHitlCheckpoint(root,"STORYBOARD","REVIEW_REQUIRED","needs_storyboard_review");
    print({ok:true,review:await approveStoryboardReview(root,"HUMAN")});
    return;
  }

  if(area==="assets"&&action==="approve"){
    await assertActiveHitlCheckpoint(root,"ASSET_PREFLIGHT","REVIEW_REQUIRED","needs_asset_preflight_approval");
    print({ok:true,...await approveProductionAssetPreflight(root)});
    return;
  }

  if(area==="renderer"&&action==="approve"){
    await assertActiveHitlCheckpoint(root,"VISUAL_REVIEW","REVIEW_REQUIRED","needs_visual_review");
    print({ok:true,...await approveSelectedRendererReview(root)});
    return;
  }

  if(area==="reopen"){
    const checkpoint=args[0] as ReopenCheckpoint|undefined;
    const option=(name:string)=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
    const reason=option("--reason"),expectedRevision=Number(option("--expected-revision")),operationId=option("--operation-id");
    if(!checkpoint||!reason||!Number.isInteger(expectedRevision))throw new Error("Usage: video:host -- reopen <VIDEO_BRIEF|SCRIPT|STORYBOARD|ASSET_PREFLIGHT|VISUAL_REVIEW> --reason <feedback> --expected-revision <generation> [--operation-id <id>]");
    print(await reopenCheckpoint(root,{checkpoint,reason,expectedRevision,...(operationId?{operationId}:{})}));return;
  }

  if(area==="duration"&&action==="choose"){
    const choice=args[0] as "shorten_script"|"revise_brief"|undefined,reason=args[1],generation=Number(args[2]);
    if(!choice||!reason||!Number.isInteger(generation))throw new Error("Usage: video:host -- duration choose <shorten_script|revise_brief> <reason> <expected-generation>");
    await assertActiveHitlCheckpoint(root,"DURATION_FIT","INPUT_REQUIRED","needs_duration_fit");
    print({ok:true,decision:await chooseDurationAction(root,choice,reason,generation)});return;
  }

  throw new Error(
    "Host-only HITL surface. Usage: video:host -- [status|clarify resolve <answers.json>|brief approve <remotion|hyperframes>|renderer select <remotion|hyperframes>|script approve|duration choose <choice> <reason> <generation>|storyboard approve|assets approve|renderer approve|reopen <checkpoint> --reason <feedback> --expected-revision <generation>]"
  );
}

main().catch(error=>{
  console.error(error instanceof Error?error.stack:error);
  process.exitCode=1;
});
