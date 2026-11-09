import assert from 'node:assert/strict';
import {cp,mkdtemp,mkdir,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import * as explorer from '../packages/app-explorer/index.mjs';
import {registerApp,resolveAppWorkspace} from '../src/app-explorer/registry.js';
import {bindResearch,researchBindingDigest} from '../src/app-explorer/research-binding.js';
import {promoteExplorerEvidence} from '../src/app-explorer/promote.js';
import {harnessPaths} from '../src/harness/paths.js';
import {archiveCurrentVideo,resetVideoWorkspace} from '../src/harness/archive.js';
import {sha256} from '../src/core/hash.js';
import {writeJson} from '../src/core/io.js';
import type {VideoProject} from '../src/core/types.js';

const png=Buffer.from(Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137]));
const project:VideoProject={meta:{title:'Synthetic Explorer fixture',width:1280,height:720,durationsInFrames:90,fps:30,theme:{palette:['#111827','#2563EB','#F8FAFC'],font:'Arial'},constraints:{style:'synthetic integration fixture',disallowed:[],motionTone:'direct'}},scenes:[{id:'scene-1',durationInFrames:90,screenText:'Synthetic result',visualConcept:'Synthetic local fixture.'}]};
const execFileAsync=promisify(execFile);

test('registered Explorer knowledge binds, survives video reset, promotes later evidence, and archives without session data',async()=>{
  const parent=await mkdtemp(join(tmpdir(),'gra-39-integration-')),root=join(parent,'host');
  await mkdir(root);
  try{
    await registerApp(root,{id:'crm',name:'Synthetic CRM',url:'https://synthetic.invalid'});
    const workspace=await resolveAppWorkspace(root,'crm');
    explorer.initWorkspace(workspace,'Synthetic CRM','https://synthetic.invalid');
    const initial=explorer.loadWorkspace(workspace);
    const member={id:'member.fixture',role:'member',tenantAlias:'tenant-fixture',environment:'synthetic',date:'2026-10-18'};
    const admin={id:'admin.fixture',role:'admin',tenantAlias:'tenant-fixture',environment:'synthetic',date:'2026-10-18'};
    const evidenceRef='run.fixture/member.png';
    await mkdir(join(workspace,'evidence','run.fixture'),{recursive:true});
    await writeFile(join(workspace,'evidence',evidenceRef),png);
    const adminEvidenceRef='run.fixture/admin-denial.txt';
    await writeFile(join(workspace,'evidence',adminEvidenceRef),'Synthetic admin-only action denied for the fixture role.\n','utf8');
    await mkdir(join(root,'.video'),{recursive:true});
    await mkdir(join(root,'assets'),{recursive:true});
    await writeJson(join(root,'assets/manifest.json'),{version:'1',assets:[]});
    const paths=harnessPaths(root);
    await writeFile(paths.request,'Demonstrate a synthetic CRM result.\n','utf8');
    await writeJson(paths.video,project);

    const scenario={id:'items.view.member',featureId:'items.view',contextId:member.id,goal:'View a synthetic item',preconditions:[],completionCriteria:[{id:'item.visible',description:'Item is visible',met:true,evidenceRefs:[evidenceRef]}],steps:[{id:'open',action:'Open item',observed:'Synthetic item is visible',evidenceRefs:[evidenceRef]}],outcome:'success',evidenceRefs:[evidenceRef],testedContext:{contextId:member.id,role:member.role,date:member.date},history:[{executionId:'execution.member.1',scenarioId:'items.view.member',outcome:'success',evidenceRefs:[evidenceRef]}]};
    const adminScenario={id:'items.admin.denial',featureId:'items.admin',contextId:admin.id,goal:'Record expected denial for an unsupported synthetic admin action',preconditions:[],completionCriteria:[{id:'action.denied',description:'The action is denied',met:true,evidenceRefs:[adminEvidenceRef]}],steps:[{id:'attempt',action:'Attempt the synthetic admin action',observed:'Access denied as expected',evidenceRefs:[adminEvidenceRef]}],outcome:'expected_denial',evidenceRefs:[adminEvidenceRef],testedContext:{contextId:admin.id,role:admin.role,date:admin.date},history:[{executionId:'execution.admin.1',scenarioId:'items.admin.denial',outcome:'expected_denial',evidenceRefs:[adminEvidenceRef]}]};
    explorer.applyObservation(workspace,{version:2,baseRevision:initial.revision,inventory:{contexts:[member,admin]},scenarios:[scenario,adminScenario],features:[{id:'items.view',title:'View item',area:'Items',summary:'Synthetic item view',status:'partial',entry:{},steps:[],questions:[],nextActions:[]},{id:'items.admin',title:'Admin-only action',area:'Items',summary:'Synthetic expected denial',status:'partial',entry:{},steps:[],questions:[],nextActions:[]}]},{executionIdFactory:(id:string)=>id===scenario.id?'execution.member.1':'execution.admin.1'});
    const nextOutput:string[]=[];
    await explorer.runKnowledgeCli(['next','--json','--data',workspace],{cwd:root,stdout:(value:string)=>nextOutput.push(value),stderr:()=>{}});
    const ready=JSON.parse(nextOutput[0]!).task;
    let data=explorer.loadWorkspace(workspace);
    assert.ok(ready,'run exposes a ready BFS task');
    assert.equal(ready.depth,Math.min(...data.frontier.tasks.filter((task:any)=>task.status==='queued').map((task:any)=>task.depth)),'ready work is selected at minimum graph depth');
    const competing=[...data.frontier.tasks.filter((task:any)=>task.status==='queued'&&task.depth===ready.depth)].sort((a:any,b:any)=>a.sequence-b.sequence);
    assert.equal(ready.id,competing[0]?.id,'same-depth tasks use durable FIFO sequence');
    assert.ok(data.frontier.tasks.some((task:any)=>task.contextId===member.id));
    assert.ok(data.frontier.tasks.some((task:any)=>task.contextId===admin.id));
    assert.equal(data.scenarios.find((item:any)=>item.id===scenario.id).testedContext.role,member.role);
    assert.equal(data.scenarios.find((item:any)=>item.id===adminScenario.id).outcome,'expected_denial');

    const started=explorer.startRun(workspace,{contextId:member.id},null,{id:'run.integration'}).run;
    let current=explorer.loadWorkspace(workspace);
    const claimedPacket=explorer.getWorkPacket(workspace,{runId:started.id});
    assert.equal(claimedPacket.activeRun.leaseId,started.leaseId,'run start returns the claimed work packet with its lease');
    const checkpoint={phase:'member item view',unknowns:['Persistence after reload is unverified.'],openQuestions:[{id:'question.reload',text:'Does the result remain after reload?'}],openTasks:[{id:'task.reload'}]};
    const checkpointPath=join(workspace,'checkpoint-fixture.json');
    await writeFile(checkpointPath,JSON.stringify(checkpoint),'utf8');
    await explorer.runKnowledgeCli(['run','checkpoint',started.id,checkpointPath,'--data',workspace],{cwd:root,stdout:()=>{},stderr:()=>{}});
    await explorer.runKnowledgeCli(['run','stop',started.id,'Synthetic user-enough checkpoint.','--data',workspace],{cwd:root,stdout:()=>{},stderr:()=>{}});
    await rm(checkpointPath,{force:true});
    data=current=explorer.loadWorkspace(workspace);
    assert.throws(()=>explorer.applyObservation(workspace,{version:2,baseRevision:initial.revision,features:[]}),/revision|conflict|stale/i,'a write against an older knowledge revision is rejected');
    const staleLeaseOutput:string[]=[];
    const staleLeaseStatus=await explorer.runKnowledgeCli(['run','heartbeat',started.id,'--lease',started.leaseId,'--data',workspace],{cwd:root,stdout:(value:string)=>staleLeaseOutput.push(value),stderr:(value:string)=>staleLeaseOutput.push(value)});
    assert.notEqual(staleLeaseStatus,0,'a retired run lease cannot be renewed');
    assert.match(staleLeaseOutput.join('\n'),/lease|retired|paused/i);
    const selection={contextIds:[member.id],scenarioIds:[scenario.id],executionIds:['execution.member.1'],evidenceRefs:[evidenceRef]};
    const bound=await bindResearch(root,{appId:'crm',knowledgeRevision:data.revision,selection,readiness:{basis:'user_enough',runId:started.id,userInstructionRef:'chat:synthetic-fixture'}});
    assert.deepEqual(bound.unknowns.checkpointUnknowns,checkpoint.unknowns);
    assert.deepEqual(bound.unknowns.checkpointQuestions,checkpoint.openQuestions);
    assert.deepEqual(bound.unknowns.checkpointTaskIds,['task.reload']);
    const digest=await researchBindingDigest(root);

    await writeFile(paths.storyboardReview,'synthetic fixture review marker; not a real host approval','utf8');
    await resetVideoWorkspace(root);
    assert.equal(explorer.loadWorkspace(workspace).revision,data.revision,'video reset retains reusable registered knowledge');
    assert.equal(await researchBindingDigest(root),null,'video reset clears only the current-video research binding');
    await writeFile(paths.request,'Demonstrate a synthetic CRM result.\n','utf8');
    const rebound=await bindResearch(root,{appId:'crm',knowledgeRevision:data.revision,selection,readiness:{basis:'user_enough',runId:started.id,userInstructionRef:'chat:synthetic-fixture'}});
    assert.equal(rebound.knowledgeRevision,data.revision,'retained knowledge can be explicitly rebound after reset');
    const currentBindingDigest=await researchBindingDigest(root);

    const requestHash=sha256(await readFile(paths.request,'utf8'));
    const projectHash=sha256(JSON.stringify(project));
    await writeJson(paths.projectState,{version:'1',projectId:'fixture',revision:1,requestHash,projectHash});
    await writeJson(paths.storyboardReview,{version:'1',requestHash,status:'approved',approvedBy:'HUMAN',contentHash:projectHash,upstreamHash:'sha256:synthetic-fixture'});
    const promotion=await promoteExplorerEvidence(root,{appId:'crm',revision:data.revision,contextId:member.id,featureId:'items.view',scenarioId:scenario.id,executionId:'execution.member.1',evidenceRef,assetId:'member-still',sceneId:'scene-1',role:'product-ui-still',rights:{rights:'Synthetic local fixture rights',permittedUse:'Synthetic integration test only'}});
    assert.equal(promotion.asset.source,'app-explorer');
    assert.equal(promotion.asset.researchEvidence?.sha256,sha256(png));

    const laterRef='run.later/admin.png';
    await mkdir(join(workspace,'evidence','run.later'),{recursive:true});
    await writeFile(join(workspace,'evidence',laterRef),png);
    const newer=explorer.loadWorkspace(workspace);
    const laterScenario={...scenario,evidenceRefs:[...scenario.evidenceRefs,laterRef],steps:scenario.steps.map((step:any)=>({...step,evidenceRefs:[...step.evidenceRefs,laterRef]})),completionCriteria:scenario.completionCriteria.map((item:any)=>({...item,evidenceRefs:[...item.evidenceRefs,laterRef]}))};
    const denialScenario={id:'items.restricted.member',featureId:'items.view',contextId:member.id,goal:'Confirm an admin-only synthetic control is denied to a member',preconditions:[],completionCriteria:[{id:'control.denied',description:'Member receives expected denial',met:true,evidenceRefs:[laterRef]}],steps:[{id:'denied',action:'Inspect admin-only control as member',observed:'Access denied as expected',evidenceRefs:[laterRef]}],outcome:'expected_denial',evidenceRefs:[laterRef],testedContext:{contextId:member.id,role:member.role,date:member.date},history:[{executionId:'execution.denial.1',scenarioId:'items.restricted.member',outcome:'expected_denial',evidenceRefs:[laterRef]}]};
    explorer.applyObservation(workspace,{version:2,baseRevision:newer.revision,scenarios:[laterScenario,denialScenario]},{executionIdFactory:(id:string)=>id===scenario.id?'execution.member.2':'execution.denial.1'});
    const laterRevision=explorer.loadWorkspace(workspace).revision;
    const later=await promoteExplorerEvidence(root,{appId:'crm',revision:laterRevision,contextId:member.id,featureId:'items.view',scenarioId:scenario.id,executionId:'execution.member.2',evidenceRef:laterRef,expectedSourceSha256:sha256(png),assetId:'later-still',sceneId:'scene-1',role:'product-ui-later',rights:{rights:'Synthetic local fixture rights',permittedUse:'Synthetic integration test only'}});
    assert.equal(later.asset.researchEvidence?.knowledgeRevision,laterRevision,'later evidence records the revision that links it');
    assert.equal(await researchBindingDigest(root),currentBindingDigest,'later evidence does not replace the frozen research binding');

    await mkdir(paths.output,{recursive:true});
    await writeFile(paths.finalVideo,'synthetic archive marker; not a rendered video','utf8');
    const archive=await archiveCurrentVideo(root,new Date('2026-10-18T00:00:00Z'));
    assert.ok(archive);
    const archivedManifest=JSON.parse(await readFile(join(root,archive!.path,'assets','manifest.json'),'utf8'));
    assert.deepEqual(archivedManifest.assets.map((asset:any)=>asset.id).sort(),['later-still','member-still']);
    const archivedImage=join(root,archive!.path,'assets',later.asset.publicPath.slice('/assets/'.length));
    assert.deepEqual(await readFile(archivedImage),png);
    const archivedBinding=JSON.parse(await readFile(join(root,archive!.path,'app-research','research-binding.json'),'utf8'));
    assert.equal(archivedBinding.knowledgeRevision,data.revision);
    assert.equal(JSON.stringify(archivedBinding).includes('synthetic-session'),false);
  }finally{await rm(parent,{recursive:true,force:true});}
});

test('packaged Explorer CLI and static assets resolve from an isolated dist tree and unrelated cwd',async()=>{
  const parent=await mkdtemp(join(tmpdir(),'gra-39-packaged-cli-')),isolated=join(parent,'isolated'),caller=join(parent,'elsewhere'),dataset=join(parent,'dataset');
  await mkdir(caller);
  try{
    await cp(resolve(process.cwd(),'dist'),join(isolated,'dist'),{recursive:true});
    await symlink(resolve(process.cwd(),'node_modules'),join(isolated,'node_modules'),'junction');
    const cli=join(isolated,'dist','packages','app-explorer','cli.mjs');
    const run=async(...args:string[])=>execFileAsync(process.execPath,[cli,...args],{cwd:caller,encoding:'utf8'});
    const initialized=await run('init','--data',dataset,'--name','Packaged fixture','--url','https://synthetic.invalid');
    assert.equal(initialized.stderr,'');
    const summary=await run('summary','--data',dataset,'--json');
    assert.equal(JSON.parse(summary.stdout).app.name,'Packaged fixture');

    const serverModule=await import(pathToFileURL(join(isolated,'dist','packages','app-explorer','server.mjs')).href);
    const server=serverModule.createServer({dataDir:dataset});
    await new Promise<void>((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});
    try{
      const address=server.address();assert.ok(address&&typeof address==='object');
      const response=await fetch(`http://127.0.0.1:${address.port}/`);
      assert.equal(response.status,200);
      const html=await response.text();
      assert.match(html,/App Explorer|Explorer/);
      assert.equal((await fetch(`http://127.0.0.1:${address.port}/app.js`)).status,200);
    }finally{await new Promise<void>((done,reject)=>server.close((error:Error|null)=>error?reject(error):done()));}
  }finally{await rm(parent,{recursive:true,force:true});}
});
