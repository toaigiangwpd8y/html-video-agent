import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import test from "node:test";

const root=process.cwd();
const read=(path:string)=>readFile(resolve(root,path),"utf8");
const approvedOrder=[
  "scene design",
  "asset resolution",
  "candidate layout/blueprint",
  "motion reasoning",
  "bounded KEEP/ADAPT/SWITCH",
  "final layout confirmation",
  "runtime choice",
  "implementation",
];
const requiredPatterns=[
  ["arrival/stagger","arrival-stagger.md"],
  ["travel/hand-off","travel-handoff.md"],
  ["reveal/progressive disclosure","progressive-reveal.md"],
  ["causal response/anticipation-impact","causal-response.md"],
  ["reposition/settle/hold","reposition-settle-hold.md"],
] as const;
const richnessPolicy="Select the motion patterns required to express the intended visual behavior and choreography faithfully. Every selected pattern must have a semantic or temporal purpose. Do not reduce motion richness to minimize the number of patterns. Do not add motion that has no communicative purpose.";

test("Full Enhance uses the approved scene-to-implementation reasoning order",async()=>{
  const skill=await read(".agents/skills/storyboard-enhance/SKILL.md");
  const handoff=await read(".agents/skills/agent-video/references/remotion-handoff.md");
  const layoutsReadme=await read(".agents/skills/storyboard-enhance/references/layouts/README.md");
  const blueprintIndex=await read(".agents/skills/storyboard-enhance/references/layouts/blueprints-index.md");
  for(const [name,text] of [["Storyboard Enhance",skill],["Remotion handoff",handoff],["layout README",layoutsReadme],["blueprint index",blueprintIndex]] as const){
    const start=text.indexOf("Full Enhance reasoning order:");
    assert.ok(start>=0,`${name} must state the Full Enhance order`);
    const order=text.slice(start,start+260).replaceAll("`","");
    const positions=approvedOrder.map(step=>order.toLowerCase().indexOf(step.toLowerCase()));
    assert.ok(positions.every(position=>position>=0),`${name} must state every approved stage`);
    for(let i=1;i<positions.length;i++)assert.ok(positions[i]>positions[i-1],`${name} must place ${approvedOrder[i]} after ${approvedOrder[i-1]}`);
  }
  assert.match(skill,/For Full Enhance, Phase 1 records semantic scene intent only; candidate selection is deferred to Phase 3 after Phase 2 asset resolution/i);
  assert.match(skill,/Scene-design \/ asset probe remains a separate bounded mode: it does not load motion or implementation guidance/i);
  assert.match(layoutsReadme,/bounded strategy-and-asset probe, separate from Full Enhance/i);
  assert.match(blueprintIndex,/For every non-trivial scene in this bounded probe mode/i);
  assert.match(handoff,/After asset resolution, read `blueprints-index\.md`/i);
  assert.match(skill,/Use capability-based runtime choice for Remotion/i);
});
test("motion index includes five required baseline patterns and validates every indexed guide",async()=>{
  const readme=await read(".agents/skills/storyboard-enhance/references/motion/README.md");
  const index=await read(".agents/skills/storyboard-enhance/references/motion/rules-index.md");
  assert.match(readme,/load only the matched rule bodies|load matched rule bodies only/i);
  assert.match(index,/load only the matched rule bodies|load matched rule bodies only/i);
  const targets=[...new Set([...index.matchAll(/\]\((patterns\/[a-z0-9-]+(?:\/[a-z0-9-]+)*\.md)\)/g)].map((match)=>match[1]))];
  assert.ok(targets.length>=requiredPatterns.length,"the five named patterns are a required baseline, not a closed set");
  for(const [group,file] of requiredPatterns){
    assert.match(index,new RegExp(group.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"i"));
    assert.ok(targets.includes(`patterns/${file}`),`index must include required baseline pattern ${file}`);
  }
  for(const target of targets){
    const guidePath=`.agents/skills/storyboard-enhance/references/motion/${target}`;
    const guide=await read(guidePath);
    for(const [section,pattern] of [["Trigger",/^\*\*Trigger\.\*/mi],["Compositional purpose",/^\*\*Compositional purpose\.\*/mi],["Failure checks",/^\*\*Failure checks\.\*/mi],["Source lineage",/^\*\*Source lineage\.\*/mi]] as const){
      assert.match(guide,pattern,`${target} needs ${section}`);
    }
    assert.match(guide,/renderer-neutral|renderer agnostic/i,`${target} must remain renderer-neutral`);
    assert.doesNotMatch(guide,/@remotion\/gsap|useGsapTimeline|useCurrentFrame|interpolate\(|\bspring\(/i,`${target} must not prescribe runtime-specific implementation APIs`);
  }
});

test("motion guidance preserves the richness-first policy and existing blueprint ownership",async()=>{
  const skill=await read(".agents/skills/storyboard-enhance/SKILL.md");
  const readme=await read(".agents/skills/storyboard-enhance/references/layouts/README.md");
  const index=await read(".agents/skills/storyboard-enhance/references/layouts/blueprints-index.md");
  const combined=[skill,readme,index].join("\n");
  assert.ok(combined.includes(richnessPolicy),"exact user-approved richness policy must be present");
  assert.match(combined,/camera-journey/);
  assert.match(combined,/reuse.*(?:layout )?blueprint|existing.*blueprint/i);
  assert.match(skill,/no new (?:workflow )?stage|not a new (?:workflow )?stage/i);
  assert.match(skill,/no persisted (?:motion )?(?:plan|artifact)|do not create.*(?:motion|animation).*(?:plan|artifact)/i);
  assert.doesNotMatch(combined,/Motion Director|Composition Director/i);
});

test("motion runtime choice leaves implementation technique to official Remotion guidance",async()=>{
  const skill=await read(".agents/skills/storyboard-enhance/SKILL.md");
  const handoff=await read(".agents/skills/agent-video/references/remotion-handoff.md");
  const motionReadme=await read(".agents/skills/storyboard-enhance/references/motion/README.md");
  const combined=`${skill}\n${handoff}\n${motionReadme}`;
  assert.match(combined,/capability-based runtime choice|choose runtime by capability/i);
  assert.match(combined,/GSAP.{0,50}(?:optional|not (?:a )?default|never universal)|(?:optional|not (?:a )?default|never universal).{0,50}GSAP/i);
  assert.match(combined,/do not omit or reduce intended motion to use a simpler API[\s\S]{0,60}choose the Remotion-supported runtime that fits/i);
  assert.match(combined,/official Remotion guidance owns implementation technique|official Remotion skills[\s\S]{0,120}(?:owns|authoritative|authority)/i);
  assert.match(combined,/installed official Remotion skills|official Remotion skill set/i);
  const runtimeStart=skill.indexOf("**Runtime choice:**"),runtimeEnd=skill.indexOf("**Implementation:**",runtimeStart);
  assert.ok(runtimeStart>=0&&runtimeEnd>runtimeStart);
  const runtimeSection=skill.slice(runtimeStart,runtimeEnd);
  assert.match(runtimeSection,/GSAP uses the official `remotion-docs` and `@remotion\/gsap` guidance, including `useGsapTimeline\(\)`/i);
  assert.match(runtimeSection,/Remotion-native[\s\S]*remotion-markup/i);
  assert.match(runtimeSection,/Do not load implementation guidance for unselected runtimes/i);
});
test("motion guidance excludes HyperFrames renderer contracts and new production artifacts",async()=>{
  const skill=await read(".agents/skills/storyboard-enhance/SKILL.md");
  const handoff=await read(".agents/skills/agent-video/references/remotion-handoff.md");
  const motionReadme=await read(".agents/skills/storyboard-enhance/references/motion/README.md");
  const motionIndex=await read(".agents/skills/storyboard-enhance/references/motion/rules-index.md");
  const combined=[skill,handoff,motionReadme,motionIndex].join("\n");
  assert.doesNotMatch(combined,/\bwindow\.__timelines\b|\bdata-(?:start|end|duration|composition-id)\b|\bnpx\s+hyperframes\b|\bnpm\s+run\s+hyperframes\b/i);
  assert.match(motionReadme,/no scene blueprint, workflow stage, director, persisted plan, artifact, agent, or checkpoint/i);
  assert.match(motionReadme,/No adapter APIs, paused-timeline\/registration contracts, or GSAP runtime preference are carried over/i);
  assert.equal(existsSync(resolve(root,".agents/skills/storyboard-enhance/references/motion-plan.json")),false);
  assert.equal(existsSync(resolve(root,".agents/skills/storyboard-enhance/references/animation-plan.json")),false);
});
