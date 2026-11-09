import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyObservation as applyObservationRaw, assetPath, checkWorkspace, exportDocs, getFeature, initWorkspace, loadWorkspace, summary, tasks, validateFeature } from '../lib/store.mjs';

// These isolated tests construct each write from the current read receipt. Stale-write cases pass their saved receipt explicitly.
function applyObservation(dir, observation, options = {}) {
  const baseRevision = options.expectedRevision ?? observation.baseRevision ?? loadWorkspace(dir).revision;
  return applyObservationRaw(dir, { ...observation, baseRevision }, { ...options, expectedRevision: options.expectedRevision ?? baseRevision });
}
const demo = path.resolve('examples/demo-knowledge');
function tempWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-explorer-test-'));
  initWorkspace(dir,'My App','https://example.org');
  return dir;
}
function partialFeature() { return {
  id:'items.create',title:'Create item',area:'Items',summary:'Create item in list.',status:'partial',
  entry:{url:'/items',label:'Items'},testedContext:{role:'member',date:'2026-10-15'},lastVerifiedAt:null,
  steps:[],questions:['What is returned?'],nextActions:[{id:'submit',goal:'Submit item',reason:'Not tested',entryPath:'/items'}]
}; }

test('demo workspace indexes six features and two journeys', () => {
  const result=checkWorkspace(demo);
  assert.equal(result.total,6); assert.equal(result.verified,2);assert.equal(result.journeys,2);assert.equal(result.tasks,5);
  assert.deepEqual(Object.keys(getFeature(demo,'projects.create')).sort(),['feature','receipt']);
});
test('init + upsert + task queue + Markdown export', (t) => {
  const dir=tempWorkspace();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const original=partialFeature();
  assert.equal(applyObservation(dir,{version:2,features:[original]}).upserted,1);
  assert.equal(summary(loadWorkspace(dir)).partial,1);
  assert.equal(tasks(loadWorkspace(dir)).some((task) => task.goal === 'Submit item'), false);
  assert.equal(tasks(loadWorkspace(dir))[0].id, 'app.discover.root');
  assert.equal(summary(loadWorkspace(dir)).tasks, tasks(loadWorkspace(dir)).length);
  assert.match(fs.readFileSync(exportDocs(dir).readmePath,'utf8'),/Create item/);
  const updated={...original,summary:'Updated description',status:'blocked'};
  applyObservation(dir,{version:2,features:[updated]});
  assert.equal(loadWorkspace(dir).features.length,1);
  assert.equal(loadWorkspace(dir).features[0].summary,'Updated description');
});
test('V2 dashboard task queue uses persisted frontier order, status, and canonical count', (t) => {
  const dir=tempWorkspace();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const feature={...partialFeature(),nextActions:[{id:'legacy-note',goal:'Feature follow-up note',reason:'Recorded in feature'}]};
  applyObservation(dir,{version:2,features:[feature],frontier:{nodes:[
    {id:'area.items',kind:'area',entryAliases:['/items'],discoveryState:'unseen',taskIds:[]},
    {id:'scenario.deep',kind:'scenario',entryAliases:['/deep'],discoveryState:'unseen',taskIds:[]},
  ],edges:[{from:'root.app',to:'area.items',relation:'contains'},{from:'area.items',to:'scenario.deep',relation:'scenario'}],tasks:[
    {id:'task.deep',key:'task.deep',nodeId:'scenario.deep',kind:'verify_scenario',status:'queued',dependencies:[],goal:'Deep task',contextId:null,depth:2,completionCriteria:['Record result'],entry:{url:'/deep'},attempts:0,lastProgressAt:null},
    {id:'task.peer',key:'task.peer',nodeId:'area.items',kind:'discover_area',status:'queued',dependencies:[],goal:'Peer task',featureId:'items.create',contextId:null,depth:1,completionCriteria:['Record result'],entry:{url:'/items'},attempts:0,lastProgressAt:null},
    {id:'task.done',key:'task.done',nodeId:'area.items',kind:'discover_area',status:'done',dependencies:[],goal:'Finished task',contextId:null,depth:1,completionCriteria:['Record result'],entry:{url:'/done'},attempts:0,lastProgressAt:null},
  ]}});
  const data=loadWorkspace(dir);
  assert.deepEqual(tasks(data).map(({id})=>id),['app.discover.root','task.peer','task.deep']);
  assert.equal(tasks(data)[1].featureTitle,'Create item');
  assert.equal(tasks(data)[1].depth,1);
  assert.equal(tasks(data)[1].sequence > tasks(data)[2].sequence,true, 'shallower task sorts first even though it was enqueued later');
  assert.equal(summary(data).tasks,3);
});

test('V2 feature-level verification is derived from validated scenarios', (t) => {
  const dir=tempWorkspace();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'evidence','old-run'),{recursive:true});
  fs.writeFileSync(path.join(dir,'evidence','old-run','open.png'),'synthetic evidence');
  const claimed={...partialFeature(),status:'verified',testedContext:{role:'member',date:'2026-10-16'},lastVerifiedAt:'2026-10-16',steps:[{id:'open',title:'Open',action:'Open form',observed:'Form appears',screenshot:'old-run/open.png'}]};
  applyObservation(dir,{version:2,features:[claimed]});
  assert.equal(loadWorkspace(dir).features[0].status, 'discovered');
  assert.equal(summary(loadWorkspace(dir)).verified, 0);
});

test('reject unsafe evidence references and missing files', (t) => {
  const dir=tempWorkspace();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  assert.throws(()=>assetPath(dir,'../secrets.txt'),/Unsafe evidence/);
  assert.throws(()=>assetPath(dir,'r/../../a.png'),/Unsafe evidence/);
  const f=partialFeature();
  f.steps=[{id:'step',title:'Look',action:'Click',observed:'Modal shown',screenshot:'run/no.png'}];
  assert.throws(()=>validateFeature(f,dir),/Missing evidence/);
});
test('journey requires known feature ID and failed apply must not update index', (t) => {
  const dir=tempWorkspace();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const f=partialFeature();
  assert.throws(()=>applyObservation(dir,{version:2,features:[f],journeys:[{id:'flow',title:'Flow',featureIds:['missing.feature']}]}),/Unknown journey feature/);
  assert.equal(loadWorkspace(dir).features.length,0);
  applyObservation(dir,{version:2,features:[f],journeys:[{id:'flow',title:'Flow',featureIds:['items.create']} ]});
  assert.equal(loadWorkspace(dir).journeys.length,1);
});
test('feature get returns only linked scenarios, contexts, and open tasks without reading unrelated features', (t) => {
  const dir=tempWorkspace();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const target={...partialFeature(),nextActions:[]};
  const other={...partialFeature(),id:'reports.export',title:'Export report',area:'Reports',nextActions:[]};
  applyObservation(dir,{version:2,features:[target,other],inventory:{contexts:[
    {id:'member.one',role:'Member',tenantAlias:'one',environment:'test',date:'2026-10-16'},
    {id:'member.two',role:'Member',tenantAlias:'two',environment:'test',date:'2026-10-16'},
    {id:'admin.two',role:'Admin',tenantAlias:'two',environment:'test',date:'2026-10-16'},
  ]},scenarios:[
    {id:'items.create.member',featureId:'items.create',contextId:'member.one',preconditions:[],goal:'Create an item',completionCriteria:[],steps:[],outcome:'unknown',evidenceRefs:[],testedContext:null,lastVerifiedAt:null},
    {id:'reports.export.admin',featureId:'reports.export',contextId:'admin.two',preconditions:[],goal:'Export a report',completionCriteria:[],steps:[],outcome:'unknown',evidenceRefs:[],testedContext:null,lastVerifiedAt:null},
  ],frontier:{nodes:[
    {id:'items.create',kind:'capability',contextId:'member.one',entryAliases:[],discoveryState:'scanned',taskIds:['items.create.inspect','items.create.node-only']},
    {id:'reports.export',kind:'capability',contextId:'admin.two',entryAliases:[],discoveryState:'scanned',taskIds:['reports.export.inspect']},
  ],edges:[],tasks:[
    {id:'items.create.inspect',key:'member.one.items.create.inspect',nodeId:'items.create',featureId:'items.create',scenarioId:'items.create.member',contextId:'member.one',kind:'verify_scenario',parentTaskId:null,depth:1,sequence:1,status:'queued',dependencies:[],goal:'Inspect item creation',completionCriteria:['Record outcome'],entry:{url:'/items'},checkpoint:{page:'form'},blocker:null,attempts:0,lastProgressAt:null},
    {id:'items.create.node-only',key:'member.two.items.create.inspect',nodeId:'items.create',contextId:'member.two',kind:'discover_capability',parentTaskId:null,depth:1,sequence:3,status:'queued',dependencies:[],goal:'Inspect capability by node ownership',completionCriteria:['Record outcome'],entry:{url:'/items/alternate'},checkpoint:null,blocker:null,attempts:0,lastProgressAt:null},
    {id:'reports.export.inspect',key:'admin.two.reports.export.inspect',nodeId:'reports.export',featureId:'reports.export',scenarioId:'reports.export.admin',contextId:'admin.two',kind:'verify_scenario',parentTaskId:null,depth:1,sequence:2,status:'queued',dependencies:[],goal:'Inspect report export',completionCriteria:['Record outcome'],entry:{url:'/reports'},checkpoint:null,blocker:null,attempts:0,lastProgressAt:null},
  ]}});
  const stored=loadWorkspace(dir);
  const {dataDir}=stored;
  assert.deepEqual(stored.features.find(({id})=>id==='items.create').openTasks,['items.create.inspect','items.create.node-only']);
  fs.writeFileSync(path.join(dataDir,'features','reports.export.json'),'not json');

  const result=getFeature(dir,'items.create');
  assert.equal(result.feature.id,'items.create');
  assert.deepEqual(result.scenarios.map(({id})=>id),['items.create.member']);
  assert.deepEqual(result.contexts.map(({id})=>id),['member.one','member.two']);
  assert.deepEqual(result.openTasks.map(({id})=>id),['items.create.inspect','items.create.node-only']);
  assert.equal(result.openTasks[0].checkpoint.page,'form');
  assert.equal(result.receipt.revision,'r000002');
  const cli=spawnSync(process.execPath,['tools/knowledge.mjs','feature','get','items.create','--data',dir,'--json'],{encoding:'utf8'});
  assert.equal(cli.status,0,cli.stderr);
  const payload=JSON.parse(cli.stdout);
  assert.deepEqual(payload.scenarios.map(({id})=>id),['items.create.member']);
  assert.deepEqual(payload.contexts.map(({id})=>id),['member.one','member.two']);
  assert.deepEqual(payload.openTasks.map(({id})=>id),['items.create.inspect','items.create.node-only']);
});
test('scenario-only coverage task references validate through apply, reload, and check', (t) => {
  const dir = tempWorkspace();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const context = {id:'member.demo',role:'Member',tenantAlias:'demo',environment:'test',date:'2026-10-16'};
  const feature = {...partialFeature(),questions:[{id:'q.scenario',text:'Does the create path work?',state:'open',contextId:context.id,taskIds:['task.scenario'],evidenceRefs:[]}]};
  const scenario = {id:'items.create.member',featureId:'items.create',contextId:context.id,goal:'Create an item',preconditions:[],completionCriteria:[],steps:[],outcome:'unknown',evidenceRefs:[],testedContext:null,lastVerifiedAt:null};
  const task = {id:'task.scenario',key:'member.demo.items.create',nodeId:scenario.id,scenarioId:scenario.id,contextId:context.id,kind:'verify_scenario',parentTaskId:null,depth:1,sequence:1,status:'queued',dependencies:[],goal:'Inspect item creation',completionCriteria:['Record outcome'],entry:{url:'/items'},checkpoint:null,blocker:null,attempts:0,lastProgressAt:null};
  applyObservation(dir,{version:2,features:[feature],inventory:{contexts:[context]},scenarios:[scenario],frontier:{nodes:[{id:scenario.id,kind:'scenario',contextId:context.id,entryAliases:[],discoveryState:'unseen',taskIds:[task.id]}],edges:[],tasks:[task]}});
  const loaded = loadWorkspace(dir);
  assert.deepEqual(loaded.features[0].questions[0].taskIds,[task.id]);
  assert.equal(checkWorkspace(dir).total,1);

  const current = fs.readFileSync(path.join(dir,'CURRENT.json'),'utf8');
  const wrongOwnerScenario = {...scenario,id:'reports.export.admin',featureId:'reports.export'};
  const wrongOwnerTask = {...task,id:'task.wrong-owner',key:'member.demo.reports.export',nodeId:wrongOwnerScenario.id,scenarioId:wrongOwnerScenario.id};
  const invalidFeature = {...feature,questions:[{...feature.questions[0],taskIds:[wrongOwnerTask.id]}]};
  const otherFeature = {...partialFeature(),id:'reports.export',title:'Export report',area:'Reports',questions:[]};
  assert.throws(()=>applyObservation(dir,{version:2,features:[invalidFeature,otherFeature],scenarios:[wrongOwnerScenario],frontier:{nodes:[{id:wrongOwnerScenario.id,kind:'scenario',contextId:context.id,entryAliases:[],discoveryState:'unseen',taskIds:[wrongOwnerTask.id]}],edges:[],tasks:[wrongOwnerTask]}}),/not linked to feature/);
  assert.equal(fs.readFileSync(path.join(dir,'CURRENT.json'),'utf8'),current);
});
test('init refuses overwriting existing data', (t) => {
  const dir=tempWorkspace();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  assert.throws(()=>initWorkspace(dir,'Again','https://example.org'),/already exists/);
});
