import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import test from "node:test";

const root=process.cwd();
const skillPath=resolve(root,".agents/skills/video-types/product-ad/SKILL.md");
const casesPath=resolve(root,"tests/fixtures/product-ad-saas/cases.json");
type Case={
  id:string;
  brief:{productType:string;objective:string;viewerTask:string;explicitStyle:string|null;productRole:string};
  expected:{primaryProfile?:string;styleDefault?:string;applySaasDefault:boolean;precedence?:string};
};

test("SaaS promo cases preserve profile precedence and default scope",async()=>{
  const cases=JSON.parse(await readFile(casesPath,"utf8")) as Case[];
  const byId=new Map(cases.map(entry=>[entry.id,entry]));
  assert.deepEqual([...byId.keys()],[
    "saas-ad-unspecified-style",
    "saas-ad-explicit-calm",
    "non-software-product-ad",
    "software-demo-task-proof",
    "software-procedural-tutorial",
    "illustrated-lecture-about-software"
  ]);

  const unspecified=byId.get("saas-ad-unspecified-style")!;
  assert.equal(unspecified.expected.primaryProfile,"product-ad");
  assert.equal(unspecified.expected.applySaasDefault,true);
  assert.match(unspecified.expected.styleDefault!,/high-energy/i);
  assert.match(unspecified.brief.productType,/software|SaaS/i);
  assert.match(unspecified.brief.objective,/campaign/i);
  assert.match(unspecified.brief.productRole,/UI.*anchor/i);

  const explicit=byId.get("saas-ad-explicit-calm")!;
  assert.equal(explicit.expected.primaryProfile,"product-ad");
  assert.equal(explicit.expected.applySaasDefault,false);
  assert.equal(explicit.expected.styleDefault,explicit.brief.explicitStyle);
  assert.equal(explicit.expected.precedence,"explicit user intent");

  for(const id of ["non-software-product-ad","software-demo-task-proof","software-procedural-tutorial","illustrated-lecture-about-software"]){
    const entry=byId.get(id)!;
    assert.equal(entry.expected.applySaasDefault,false,id);
  }
  assert.equal(byId.get("non-software-product-ad")!.expected.primaryProfile,"product-ad");
  assert.equal(byId.get("software-demo-task-proof")!.expected.primaryProfile,"product-demo");
  assert.equal(byId.get("software-procedural-tutorial")!.expected.primaryProfile,"procedural-tutorial");
  assert.equal(byId.get("illustrated-lecture-about-software")!.expected.primaryProfile,undefined);
});

test("product-ad skill defines the scoped SaaS default and keeps user intent and fidelity authoritative",async()=>{
  const skill=await readFile(skillPath,"utf8");
  const success=skill.slice(skill.indexOf("## Success Definition"),skill.indexOf("### Use when"));
  const creative=skill.slice(skill.indexOf("## Creative Guidance"),skill.indexOf("## Self-review Guidance"));

  assert.match(success,/software|SaaS/i);
  assert.match(success,/default/i);
  assert.match(success,/high[- ]energy/i);
  assert.match(success,/campaign|message|recall/i);
  assert.match(success,/product.{0,40}(?:motion|UI)|(?:motion|UI).{0,40}product/i);
  assert.match(success,/explicit.{0,35}(?:intent|style).{0,35}(?:authoritative|priority|override|precedence)|(?:authoritative|priority|override|precedence).{0,35}explicit/i);
  assert.match(creative,/software|SaaS/i);
  assert.match(creative,/fidelity|truth|accurate|supported/i);
  assert.match(creative,/explicit.{0,35}(?:intent|style).{0,35}(?:overrides|wins|takes precedence|authoritative)|(?:explicit|user).{0,35}(?:overrides|wins|takes precedence|authoritative)/i);
  assert.match(creative,/browser frame is optional/i,
    "the hashed skill should make clear that a browser frame is not a required composition");
  assert.match(creative,/detached or recombined UI elements are optional craft choices/i,
    "specific UI choreography examples should not become mandatory structure");

  assert.match(skill,/\[[^\]]+\]\(references\/saas-product-promo\.md\)/,
    "skill should use a skill-relative SaaS examples link");
});

test("SaaS promo skill covers message-led UI transformation and bounded claim proof",async()=>{
  const skill=await readFile(skillPath,"utf8");
  const referencePath=resolve(root,".agents/skills/video-types/product-ad/references/saas-product-promo.md");
  const reference=await readFile(referencePath,"utf8");
  const creative=skill.slice(skill.indexOf("## Creative Guidance"),skill.indexOf("## Self-review Guidance"));
  const selfReview=skill.slice(skill.indexOf("## Self-review Guidance"),skill.indexOf("## Development Guidance"));

  assert.match(reference,/dominant (?:product )?message/i);
  assert.match(reference,/opening/i);
  assert.match(reference,/UI.{0,50}(?:transform|recombin|reassembl)|(?:transform|recombin|reassembl).{0,50}UI/i);
  assert.match(reference,/feature payoff/i);
  assert.match(reference,/closing/i);
  assert.match(reference,/guidance.{0,60}(?:scene count|fixed)|(?:scene count|fixed).{0,60}guidance/i);
  assert.match(reference,/read(?:ing)? (?:time|pace)|readable.{0,30}(?:hold|pace|time)/i);
  assert.match(reference,/overshoot/i);
  assert.match(reference,/browser frame.{0,80}(?:optional|not required)|(?:optional|not required).{0,80}browser frame/i);

  assert.match(creative,/causal|cause.{0,15}effect/i);
  assert.match(creative,/enough|sufficient|proportionate/i);
  assert.match(creative,/need not show every click/i);
  assert.match(creative,/unless the brief requires/i);
  assert.match(selfReview,/central message|dominant message/i);
  assert.match(selfReview,/UI.{0,50}(?:payoff|decorative|background)|(?:payoff|decorative|background).{0,50}UI/i);
  assert.match(selfReview,/typography/i);
  assert.match(selfReview,/compete against the UI/i);
  assert.match(selfReview,/rhythm.{0,60}(?:sound|message)|(?:sound|message).{0,60}rhythm/i);
  assert.match(selfReview,/tutorial/i);
});

test("SaaS renderer guidance choreographs meaningful beats and keeps screenshots distinct from UI elements",async()=>{
  const skill=await readFile(skillPath,"utf8");
  const referencePath=resolve(root,".agents/skills/video-types/product-ad/references/saas-product-promo.md");
  const reference=await readFile(referencePath,"utf8");
  const renderer=skill.slice(skill.indexOf("## Renderer Guidance"));
  const material=`${renderer}\n${reference}`;

  assert.match(renderer,/meaningful (?:message or product-state )?beats?|meaningful message turns/i);
  assert.match(renderer,/hard cuts?/i);
  assert.match(renderer,/snap/i);
  assert.match(renderer,/whip/i);
  assert.match(renderer,/flash/i);
  assert.match(renderer,/match cuts?/i);
  assert.match(renderer,/selective|selectively|when .*meaningful|as appropriate/i,
    "transitions should be chosen for meaningful beats rather than applied universally");
  assert.match(material,/screenshot.{0,100}(?:layer|frame)|(?:layer|frame).{0,100}screenshot/i);
  assert.match(material,/UI element.{0,100}(?:layer|capture)|(?:layer|capture).{0,100}UI element/i);
  assert.match(material,/element capture/i);
  assert.match(material,/provenance/i);
  assert.match(material,/post[- ](?:Storyboard[- ])?approval|after Storyboard approval/i);
  assert.match(material,/truthful derivative|truthful.{0,40}derivative/i);
  assert.match(material,/do not invent|must not invent|not invent/i);
});

test("SaaS sound guidance supports selective effects, readable holds, and approved voiceover",async()=>{
  const skill=await readFile(skillPath,"utf8");
  const referencePath=resolve(root,".agents/skills/video-types/product-ad/references/saas-product-promo.md");
  const reference=await readFile(referencePath,"utf8");
  const renderer=skill.slice(skill.indexOf("## Renderer Guidance"));
  const material=`${renderer}\n${reference}`;

  assert.match(material,/fast (?:background )?music|fast BGM/i);
  assert.match(material,/SFX|sound effects/i);
  assert.match(material,/click/i);
  assert.match(material,/whoosh/i);
  assert.match(material,/impact/i);
  assert.match(material,/selective|selectively|sparing|when (?:it )?(?:supports|serves|marks)/i);
  assert.match(material,/voice intelligibility|voice.{0,40}intelligib|music.{0,60}voice|voice.{0,60}music/i);
  assert.match(material,/readable hold|hold.{0,50}read|reading time/i);
  assert.match(material,/approved voiceover|brief-approved voiceover|approved narration/i);
  assert.match(material,/do not (?:speed|trim)|never (?:speed|trim)|native speed/i);
  assert.doesNotMatch(material,/\b\d+\s*BPM\b|(?:must|should|required to) (?:use|include|apply) every (?:effect|transition)/i);
});

test("SaaS renderer guidance preserves existing phase boundaries and canonical copy",async()=>{
  const skill=await readFile(skillPath,"utf8");
  const authoring=await readFile(resolve(root,".agents/skills/agent-video/references/authoring.md"),"utf8");
  const enhance=await readFile(resolve(root,".agents/skills/storyboard-enhance/SKILL.md"),"utf8");
  const renderer=skill.slice(skill.indexOf("## Renderer Guidance"));

  assert.match(authoring,/Do not search for, download, generate, or bind visual\/source production media before Storyboard approval/i);
  assert.match(authoring,/production media is acquired and registered after approval in `assets\/manifest\.json`/i);
  assert.match(renderer,/selected renderer/i);
  assert.match(renderer,/Remotion.{0,80}HyperFrames|HyperFrames.{0,80}Remotion/i);
  assert.match(renderer,/canonical (?:in )?`video\.json`|canonical fields/i);
  assert.match(renderer,/`visualConcept`/);
  assert.match(renderer,/`screenText`/);
  assert.match(renderer,/`meta\.theme`/);
  assert.match(renderer,/`meta\.constraints`/);
  assert.match(renderer,/`audio\.voiceoverText`/);
  assert.match(enhance,/Software UI assets/i);
  assert.match(enhance,/after Storyboard approval|post-approval/i);
});

test("all six synthetic SaaS promo cases have bounded manual skill-fit verdicts",async()=>{
  const cases=JSON.parse(await readFile(casesPath,"utf8")) as Array<Case & {manualReview?:{verdict:string;rationale:string}}>;
  assert.equal(cases.length,6);
  for(const entry of cases){
    assert.equal(entry.manualReview?.verdict,"pass",entry.id);
    assert.ok(entry.manualReview?.rationale.trim(),`${entry.id} needs concise manual evidence`);
    assert.ok(entry.manualReview!.rationale.length<=220,`${entry.id} review should remain concise`);
  }
});
