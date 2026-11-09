import {resolve} from "node:path";

export interface HarnessPaths {
  root:string; videoInput:string; request:string; productionProfile:string; clarification:string; videoBrief:string; webCaptureRuns:string;
  rendererSelection:string; scriptDraft:string; scriptReview:string; storyboardDraft:string; storyboardReview:string;
  videoTypeCatalog:string; videoTypeSkillsRoot:string; video:string; projectState:string; assetManifest:string;
  sources:string; sourceIndex:string; revisions:string; preflight:string; productionPreflight:string;
  productionPreflightState:string; productionPreflightApproval:string;
  narrationInput:string; narrationManifest:string; narrationCache:string; narrationWorker:string;
  reopenLedger:string; reconciliation:string; editGeneration:string; durationDecision:string;
  rendererCarryForward:string;
  reviewChanges:string;
  researchBinding:string;
  remotion:string; remotionProjects:string; remotionGenerated:string; remotionProject:string; remotionAssetManifest:string;
  remotionTimeline:string; remotionPublicAssets:string; remotionRendererState:string; remotionManifest:string;
  hyperframes:string; hyperframesProjects:string; hyperframesKit:string; rendererState:string; manifest:string;
  finalManifest:string; candidateManifest:string; output:string; preview:string; finalVideo:string; archive:string;
  layoutLint:string;
  boundaryEvidenceDir:string; boundaryEvidenceIndex:string; agentVideoSkill:string; officialRemotionSkillsRoot:string;
  remotionSkill:string; editorialMotionSkill:string;
}

export function harnessPaths(root=process.cwd()):HarnessPaths {
  const base=resolve(root),sources=resolve(base,".video/sources");
  return {
    root:base, videoInput:resolve(base,"video-input"), request:resolve(base,".video/request.txt"), webCaptureRuns:resolve(base,".video/web-capture/runs"),
    productionProfile:resolve(base,".video/production-profile.json"), clarification:resolve(base,".video/clarification.json"),
    videoBrief:resolve(base,".video/video-brief.json"), rendererSelection:resolve(base,".video/renderer-selection.json"),
    scriptDraft:resolve(base,".video/script.md"), scriptReview:resolve(base,".video/script-review.json"),
    storyboardDraft:resolve(base,".video/storyboard.json"), storyboardReview:resolve(base,".video/storyboard-review.json"),
    videoTypeCatalog:resolve(base,".agents/skills/video-types/catalog.json"), videoTypeSkillsRoot:resolve(base,".agents/skills/video-types"),
    video:resolve(base,"video.json"), projectState:resolve(base,".video/project-state.json"), assetManifest:resolve(base,"assets/manifest.json"),
    sources, sourceIndex:resolve(sources,"index.json"), revisions:resolve(base,".video/revisions"), preflight:resolve(base,".video/preflight.json"),
    productionPreflight:resolve(base,".video/production-preflight.json"),
    productionPreflightState:resolve(base,".video/production-preflight-state.json"),
    productionPreflightApproval:resolve(base,".video/production-preflight-approval.json"),
    narrationInput:resolve(base,".video/narration-input.json"), narrationManifest:resolve(base,".video/narration-manifest.json"),
    narrationCache:resolve(base,".video/tts-cache"), narrationWorker:resolve(base,"scripts/tts/worker.py"),
    reopenLedger:resolve(base,".video/reopen-ledger.json"), reconciliation:resolve(base,".video/reconciliation.json"),
    editGeneration:resolve(base,".video/edit-generation.json"), durationDecision:resolve(base,".video/duration-decision.json"),
    rendererCarryForward:resolve(base,".video/renderer-carry-forward.json"),
    reviewChanges:resolve(base,".video/hitl-review-changes.json"),
    researchBinding:resolve(base,".video/research-binding.json"),
    remotion:resolve(base,"remotion"), remotionProjects:resolve(base,"remotion/projects"),
    remotionGenerated:resolve(base,"remotion/generated"), remotionProject:resolve(base,"remotion/generated/project.json"),
    remotionAssetManifest:resolve(base,"remotion/generated/asset-manifest.json"), remotionTimeline:resolve(base,"remotion/generated/timeline.json"),
    remotionPublicAssets:resolve(base,"remotion/public/assets"), remotionRendererState:resolve(base,".video/remotion-state.json"),
    remotionManifest:resolve(base,"remotion/implementation-manifest.json"), hyperframes:resolve(base,"hyperframes"),
    hyperframesProjects:resolve(base,"hyperframes/projects"), hyperframesKit:resolve(base,"hyperframes/kit"),
    rendererState:resolve(base,".video/hyperframes-state.json"), manifest:resolve(base,"hyperframes/implementation-manifest.json"),
    finalManifest:resolve(base,".video/final-manifest.json"), candidateManifest:resolve(base,".video/implementation-manifest.candidate.json"),
    output:resolve(base,"output"), preview:resolve(base,"output/preview.png"), finalVideo:resolve(base,"output/final.mp4"), archive:resolve(base,"archive"),
    layoutLint:resolve(base,".video/layout-lint.json"),
    boundaryEvidenceDir:resolve(base,"output/evidence"), boundaryEvidenceIndex:resolve(base,".video/hyperframes-boundary-evidence.json"),
    agentVideoSkill:resolve(base,".agents/skills/agent-video"), officialRemotionSkillsRoot:resolve(base,".agents/skills"),
    remotionSkill:resolve(base,".agents/skills/remotion-best-practices"), editorialMotionSkill:resolve(base,".agents/skills/remotion-editorial-motion")
  };
}
