import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCompatibilityLedger, classifyRenderedPair} from '../scripts/shotcraft-compatibility.mjs';
import {assertNoRemoteMedia} from '../scripts/shotcraft-compatibility-target.mjs';
import {validateTypecheckResult} from '../scripts/shotcraft-compatibility-typecheck.mjs';
import {fontProbeStyle} from '../scripts/shotcraft-compatibility-render.mjs';
import {proveStaleReviewInvalidation} from '../scripts/shotcraft-compatibility-stale.mjs';
import {createCompatibilityFixtures} from '../scripts/shotcraft-compatibility-fixtures.mjs';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const catalog={cards:[{id:'card-a',category:'typography',variants:[{id:'a',source:{demo:['demos/a.tsx'],closure:['demos/a.tsx']}},{id:'b',source:{demo:['demos/b.tsx'],closure:['demos/b.tsx']}}]}]};

test('retains every catalog variant and emits the exact compatibility status contract',()=>{
  const ledger=buildCompatibilityLedger(catalog,[{variantId:'a',status:'smoke_passed',reason:'Paired output hashes match.',evidence:['a.png'],runtimeVersion:'4.0.538'}]);
  assert.equal(ledger.denominator,2);
  assert.deepEqual(ledger.items.map(item=>item.status),['smoke_passed','source_only']);
  for(const item of ledger.items){assert.ok(['source_only','smoke_passed','blocked'].includes(item.status));assert.equal(typeof item.reason,'string');assert.ok(Array.isArray(item.evidence));assert.ok('runtimeVersion' in item);}
});

test('rejects unknown and legacy compatibility statuses',()=>{
  for(const status of ['pass','pending','skip'])assert.throws(()=>buildCompatibilityLedger(catalog,[{variantId:'a',status,reason:'x',evidence:['x'],runtimeVersion:'4.0.538'}]),/unsupported compatibility status/i);
});

test('does not classify successful renders as smoke_passed when any still or clip hash differs',()=>{
  const result=classifyRenderedPair({
    original:{renderStatus:'rendered',runtimeVersion:'4.0.538',stillHashes:{0:'same',10:'a'},clipHash:'clip-a',evidence:['orig.mp4','orig-0.png','orig-10.png']},
    adapted:{renderStatus:'rendered',runtimeVersion:'4.0.538',stillHashes:{0:'same',10:'b'},clipHash:'clip-b',evidence:['adapt.mp4','adapt-0.png','adapt-10.png']},
  });
  assert.equal(result.status,'blocked');
  assert.match(result.reason,/hash mismatch/i);
  assert.ok(result.evidence.length>0);
});

test('does not classify successful renders as smoke_passed when only the motion clip hash differs',()=>{
  const result=classifyRenderedPair({
    original:{renderStatus:'rendered',runtimeVersion:'4.0.538',stillHashes:{0:'same'},clipHash:'clip-a',evidence:['original.mp4']},
    adapted:{renderStatus:'rendered',runtimeVersion:'4.0.538',stillHashes:{0:'same'},clipHash:'clip-b',evidence:['adapted.mp4']},
  });
  assert.equal(result.status,'blocked');
  assert.match(result.reason,/clip SHA-256 hash mismatch/i);
});

test('target source allows local manifest media and blocks remote media references',()=>{
  assert.equal(assertNoRemoteMedia('staticFile("assets/canonical.svg")'),true);
  assert.throws(()=>assertNoRemoteMedia('<Img src="https://example.invalid/preview.png"/>'),/remote media\/resource URL/i);
});

test('emits generic CSS font families unquoted and named families quoted',()=>{
  assert.equal(fontProbeStyle('monospace'), 'font:600 64px monospace');
  assert.equal(fontProbeStyle('sans-serif'), 'font:600 64px sans-serif');
  assert.equal(fontProbeStyle('Helvetica Neue'), 'font:600 64px &quot;Helvetica Neue&quot;,sans-serif');
});

test('uses generated mock PageCam texture bytes and records repository provenance',async()=>{
  const root=resolve('.');
  const scratch=await mkdtemp(resolve(tmpdir(),'shotcraft-pagecam-texture-'));
  try{
    const outputRoot=resolve(scratch,'evidence');
    const generatedRoot=resolve(scratch,'generated');
    await mkdir(outputRoot,{recursive:true});
    const fixture=await createCompatibilityFixtures({root,outputRoot,generatedRoot});
    const sample=fixture.samples.find(item=>item.sampleId==='helper-pagecam-row-embed');
    const provenance=sample.assets?.find(asset=>asset.publicPath==='textures/live/detail-full.png');
    assert.ok(provenance,'PageCam texture provenance must be part of the fixture sample record');
    assert.equal(provenance.sourcePath,'demos/_textures/detail-full.png');
    const upstream=JSON.parse(await readFile(resolve(root,'third-party/video-shotcraft/SOURCE.json'),'utf8'));
    const sourceRecord=upstream.files.find(file=>file.path===provenance.sourcePath);
    const fixtureBytes=await readFile(resolve(generatedRoot,'public/textures/live/detail-full.png'));
    const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
    assert.equal(provenance.sha256,sourceRecord.sha256);
    assert.equal(digest(fixtureBytes),sourceRecord.sha256);
    assert.ok(upstream.mediaReplacement.sourcePaths.includes(provenance.sourcePath));
    assert.match(sourceRecord.upstreamSha256,/^[a-f0-9]{64}$/);
    assert.match(upstream.mediaReplacement.generator,/generate-shotcraft-mock-textures/);
    assert.deepEqual(provenance.dimensions,{width:3840,height:2344});
    assert.deepEqual([fixtureBytes.readUInt32BE(16),fixtureBytes.readUInt32BE(20)],[3840,2344]);
  }finally{await rm(scratch,{recursive:true,force:true});}
});

test('requires runtime, reason and evidence for each explicit ledger status',()=>{
  assert.throws(()=>buildCompatibilityLedger(catalog,[{variantId:'a',status:'smoke_passed',reason:'ok',evidence:[]}]),/runtimeVersion/i);
  assert.throws(()=>buildCompatibilityLedger(catalog,[{variantId:'a',status:'blocked',reason:'',evidence:[],runtimeVersion:null}]),/reason/i);
});

test('fails closed when the catalog typecheck exits nonzero without diagnostics',()=>{
  assert.throws(()=>validateTypecheckResult({status:1,output:'',error:null}),/nonzero.*without TypeScript diagnostics/i);
  assert.throws(()=>validateTypecheckResult({status:null,output:'',error:new Error('spawn failed')}),/could not start TypeScript/i);
  assert.throws(()=>validateTypecheckResult({status:1,output:"src/a.tsx(1,1): error TS2307: Cannot find module '@remotion/motion-blur'.",error:null,signal:'SIGTERM'}),/terminated by signal SIGTERM/i);
});

test('editing a selected generated source makes the Remotion review status stale without an approval record',async()=>{
  const root=await mkdtemp(resolve(tmpdir(),'shotcraft-stale-review-'));
  try{
    const proof=await proveStaleReviewInvalidation(root,{sourcePath:'remotion/generated/compatibility/Selected.tsx'});
    assert.equal(proof.before.status,'REVIEW_REQUIRED');
    assert.equal(proof.before.phase,'needs_visual_review');
    assert.equal(proof.after.phase,'renderer_source_changed');
    assert.equal(proof.after.payload.approvalInvalidated,true);
    assert.equal(proof.humanApprovalRecorded,false);
    assert.equal(proof.stateHasVisualApproval,false);
  }finally{await rm(root,{recursive:true,force:true});}
});
