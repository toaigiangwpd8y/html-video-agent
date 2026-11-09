import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import test from "node:test";

const root=process.cwd();
const basePath=resolve(root,".agents/skills/agent-video/references/scriptwriting.md");
const read=(file:string)=>readFile(resolve(root,file),"utf8");

test("base scriptwriting keeps universal multi-channel and progression constraints",async()=>{
  const base=await read(".agents/skills/agent-video/references/scriptwriting.md");
  assert.match(base,/Spoken narration \(`audio\.voiceoverText`\)/);
  assert.match(base,/Visible anchor copy \(`screenText`\)/);
  assert.match(base,/Script owns story logic, claims, evidence\/source requirements/i);
  assert.match(base,/narrative\/explanatory progression|why the next beat follows: causally/i);
  assert.match(base,/Every material claim must have/i);
  assert.match(base,/screen copy.*complement speech|screen text must complement speech/i);
  assert.match(base,/generic filler|empty intensifiers|marketing buzzwords/i);
  assert.ok(basePath.endsWith("scriptwriting.md"));
});

test("script visual evidence stays semantic while materialized TTS remains operational state",async()=>{
  const base=await read(".agents/skills/agent-video/references/scriptwriting.md");
  assert.match(base,/Script owns story logic, claims, evidence\/source requirements[\s\S]*does \*\*not\*\* author canonical `visualConcept`/i);
  assert.doesNotMatch(base,/Visual evidence \(`visualConcept`\): Renderer-facing specification/i);
  assert.match(base,/At the Script checkpoint[\s\S]*Author must also materialize TTS with the existing production voice path/i);
  assert.match(base,/Storyboard Enhance later reuses and registers the approved materialized voice-over/i);
  assert.doesNotMatch(base,/Before Storyboard commit,[\s\S]*listen to every generated clip/i);
});

test("base and nontechnical documentary-compatible profiles do not import technical proof doctrine",async()=>{
  const base=await read(".agents/skills/agent-video/references/scriptwriting.md");
  const documentaryCompatible=await read(".agents/skills/video-types/general-narrative/SKILL.md");
  assert.match(documentaryCompatible,/documentary/i);
  const technicalOnly=[
    /technical tension/i,
    /exact file path, interface signature, data flow payload, benchmark delta/i,
    /sound like a real technical discussion/i,
    /Portability Test \(Swap Test\)/i,
  ];
  for(const rule of technicalOnly){
    assert.doesNotMatch(base,rule,`base scriptwriting contains technical-only rule ${rule}`);
    assert.doesNotMatch(documentaryCompatible,rule,`documentary-compatible profile contains technical-only rule ${rule}`);
  }
});

test("technical-explainer owns technical scriptwriting constraints",async()=>{
  const skill=await read(".agents/skills/video-types/technical-explainer/SKILL.md");
  const reference=await read(".agents/skills/video-types/technical-explainer/references/scriptwriting.md");
  assert.match(skill,/Scriptwriting/);
  assert.match(skill,/references\/scriptwriting\.md/);
  assert.match(reference,/technical tension/i);
  assert.match(reference,/file path, interface signature, data flow payload, benchmark delta/i);
  assert.match(reference,/technical discussion/i);
  assert.match(reference,/Portability Test \(Swap Test\)/i);
});
