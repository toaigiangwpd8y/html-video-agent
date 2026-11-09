import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import test from "node:test";

const root=process.cwd();
const read=(file:string)=>readFile(resolve(root,file),"utf8");

test("Author flow keeps one Script and one bounded self-check across all active profile skills",async()=>{
  const skill=await read(".agents/skills/agent-video/SKILL.md");
  const authoring=await read(".agents/skills/agent-video/references/authoring.md");
  const scriptwriting=await read(".agents/skills/agent-video/references/scriptwriting.md");
  assert.match(skill,/one complete Script/i);
  assert.match(authoring,/one bounded pre-review self-check/i);
  assert.match(scriptwriting,/Bounded pre-review self-check/i);
  const profileIds=["concept-explainer","data-report","general-narrative","illustrated-explainer","lecture-explainer","neutral","persuasive-pitch","procedural-tutorial","product-ad","product-demo","technical-explainer"];
  for(const id of profileIds){
    const profile=await read(`.agents/skills/video-types/${id}/SKILL.md`);
    assert.doesNotMatch(profile,/three candidates|3 candidates|winner'?s|winning mechanism|dedicated critic|critic round|model-side final selection|iterative model-review/i,`${id} reintroduces the removed author tournament`);
  }
});

test("agent-facing CLI has no author tournament or manual project promotion surface",async()=>{
  const cli=await read("src/cli.ts");
  const clarification=await read("src/harness/clarification.ts");
  const reviews=await read("src/harness/preproduction-hitl.ts");
  assert.doesNotMatch(cli,/area==="author"|video author/i);
  assert.doesNotMatch(cli,/project commit/i);
  assert.match(clarification,/npm run video:host -- clarify resolve/);
  assert.match(reviews,/npm run video:host -- brief approve/);
  assert.match(reviews,/npm run video:host -- script approve/);
  assert.match(reviews,/npm run video:host -- storyboard approve/);
});

test("Author phase does not acquire production media or apply Renderer Guidance",async()=>{
  const authoring=await read(".agents/skills/agent-video/references/authoring.md");
  assert.match(authoring,/only user-provided or already-authoritative pre-existing assets/i);
  assert.match(authoring,/Do not search for, download, generate, or bind visual\/source production media before Storyboard approval/i);
  assert.match(authoring,/Do not apply the profile's `Renderer Guidance` before Storyboard approval/i);
  assert.match(authoring,/production media is acquired and registered after approval in `assets\/manifest\.json`/i);
});

test("screenText word count is a heuristic rather than an Author hard cap",async()=>{
  const scriptwriting=await read(".agents/skills/agent-video/references/scriptwriting.md");
  const authoring=await read(".agents/skills/agent-video/references/authoring.md");
  for(const text of [scriptwriting,authoring]){
    assert.match(text,/5-8 words[\s\S]{0,180}not a hard cap/i);
    assert.doesNotMatch(text,/5-8 words maximum|max 5-8 words/i);
  }
});

test("illustrated-explainer Authors semantic illustration jobs, not concrete production vocabulary or resolved audio",async()=>{
  const skill=await read(".agents/skills/video-types/illustrated-explainer/SKILL.md");
  assert.match(skill,/Author the job of the illustration, not its concrete production vocabulary/i);
  assert.match(skill,/do not choose a concrete illustration vocabulary/i);
  assert.match(skill,/Post-approval Storyboard Enhance selects the concrete visual strategy, assets, and coherent vocabulary/i);
  assert.match(skill,/only the exact approved spoken wording in optional `audio\.voiceoverText`/i);
  assert.doesNotMatch(skill,/real resolved file/i);
  assert.doesNotMatch(skill,/inaudible declared narration/i);
});

test("production asset replacement does not force a canonical video.json patch",async()=>{
  const editing=await read(".agents/skills/agent-video/references/editing.md");
  assert.match(editing,/concrete production asset binding is not canonical by itself/i);
  assert.match(editing,/If only a production asset is replaced[\s\S]*update `assets\/manifest\.json`, the selected renderer project, and derived evidence without patching `video\.json`/i);
  assert.doesNotMatch(editing,/required evidence, asset binding, or semantic continuity changes, patch canonical/i);
});

test("Storyboard Enhance stays within its existing human checkpoints",async()=>{
  const skill=await read(".agents/skills/agent-video/SKILL.md");
  const enhance=await read(".agents/skills/storyboard-enhance/SKILL.md");
  assert.match(skill,/one complete Storyboard Enhance pass/i);
  assert.match(enhance,/do not create candidate loops, a Critic round, or additional HITL checkpoints/i);
  assert.match(skill,/ASSET_PREFLIGHT[\s\S]*VISUAL_REVIEW/);
});

test("technical script proof stays semantic instead of freezing diagram topology",async()=>{
  const reference=await read(".agents/skills/video-types/technical-explainer/references/scriptwriting.md");
  assert.match(reference,/do not treat a generic architecture depiction as sufficient proof/i);
  assert.match(reference,/concrete diagram topology remains post-approval presentation work/i);
});

test("Shotcraft use stays inside canonical authoring, asset, renderer, and HITL boundaries",async()=>{
  const skill=await read(".agents/skills/storyboard-enhance/SKILL.md");
  const guide=await read(".agents/skills/storyboard-enhance/references/shotcraft/README.md");
  assert.match(skill,/Shotcraft/);
  assert.match(skill,/after.*blueprint|blueprint.*before.*Shotcraft/i);
  assert.match(skill,/USE|ADAPT|NONE/);
  assert.match(skill,/explicitly requested.*shot|user.*shot/i);
  assert.match(skill,/selected renderer/i);
  assert.match(skill,/asset.*manifest|manifest.*asset/i);
  assert.match(skill,/HITL|human checkpoint/i);
  assert.match(guide,/Ink Press[\s\S]*optional[\s\S]*not a default/i);
  assert.match(guide,/web-app-capture/);
  assert.match(guide,/unknown-source[\s\S]*blocked/i);
  assert.match(guide,/rights provenance|rights.*approval/i);
  assert.match(guide,/canonical `video\.json`|canonical semantics/i);
  assert.match(guide,/source[- ]hash|hash coverage/i);
  assert.match(guide,/no.*Puppeteer|Puppeteer.*bypass/i);
  assert.match(guide,/do not.*automatic browser discovery|no automatic browser discovery/i);
  assert.doesNotMatch(skill,/new approval checkpoint|autonomous approval/i);
});
