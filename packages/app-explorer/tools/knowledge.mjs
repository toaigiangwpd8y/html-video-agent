#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { applyObservation, checkWorkspace, DEMO_PATH, exportDocs, getFeature, initWorkspace, loadWorkspace, migrateWorkspace, summary, tasks, workspacePath } from '../lib/store.mjs';
import { frontierSummary, transitionTask } from '../lib/frontier.mjs';
import { browserInfoFromInspection, inspectBrowserCli, validateBrowserMode } from '../lib/browser-capabilities.mjs';
import { advanceRun, checkpointRun, deriveRunState, fenceStaleRunRecovery, heartbeatRun, liveOwnedTaskIds, runHeartbeatThresholdMs, selectNextUnowned, startRun, stopRun } from '../lib/runs.mjs';
import { auditCoverage, reconcileCoverage } from '../lib/coverage.mjs';
import { readDiagnostics, recordDiagnostic } from '../lib/diagnostics.mjs';
import { getWorkPacket, createDraft } from '../lib/agent-workflow.mjs';
import { readJsonObject, writeJsonUtf8 } from '../lib/json-io.mjs';

function arg(name, argv = process.argv) { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i+1]; }
function expectedRevision(argv = process.argv) {
  if (!argv.includes('--expected-revision')) return undefined;
  const revision = arg('--expected-revision', argv);
  if (!revision || revision.startsWith('--')) throw new Error('--expected-revision requires a revision ID.');
  return revision;
}
function help(write = console.log) { write(`App Explorer CLI (Node.js >=22.18.0, no npm install needed)

  node tools/knowledge.mjs init --data ./my-app --name "My App" --url https://example.com
  node tools/knowledge.mjs migrate --data ./existing-v1
  node tools/knowledge.mjs summary --data ./my-app
  node tools/knowledge.mjs next --data ./my-app [--json]
  node tools/knowledge.mjs work --context <id> --run <id> --json --data ./my-app
  node tools/knowledge.mjs draft --packet <packet.json> --output <observation.json> --data ./my-app
  node tools/knowledge.mjs coverage audit --data ./my-app [--context <id>] [--json]
  node tools/knowledge.mjs coverage reconcile --context <id> --expected-revision <revision> --data ./my-app
  node tools/knowledge.mjs task start <id> --data ./my-app
  node tools/knowledge.mjs task checkpoint <id> <file.json> --data ./my-app
  node tools/knowledge.mjs task finish <id> <file.json> --data ./my-app
  node tools/knowledge.mjs task block <id> <file.json> --data ./my-app
  node tools/knowledge.mjs task resume <id> --data ./my-app
  node tools/knowledge.mjs run start <scope.json> [--browser <executable>] [--session <alias>] --data ./my-app
  node tools/knowledge.mjs run checkpoint <id> <file.json> --data ./my-app
  node tools/knowledge.mjs run advance <id> <observation.json> --lease <id> --request-id <id> [--expected-revision <revision>] --data ./my-app
  node tools/knowledge.mjs run heartbeat <id> --lease <lease-id> [--task <task-id>] --data ./my-app
  node tools/knowledge.mjs run stop <id> <reason> --data ./my-app
  node tools/knowledge.mjs diagnostic record <event.json> --data ./my-app
  node tools/knowledge.mjs diagnostic list --json --data ./my-app
  node tools/knowledge.mjs apply path/to/observation.json --expected-revision r000001 --data ./my-app
  node tools/knowledge.mjs check --data ./my-app
  node tools/knowledge.mjs export --data ./my-app
  node tools/knowledge.mjs feature get items.create --data ./my-app --json
  node tools/knowledge.mjs doctor --browser <agent-browser-executable> [--mode isolated|attach|profile|restore] [--allowed-domains] [--json]

If --data is omitted, KNOWLEDGE_DIR must name a workspace. The included example workspace is available only by selecting it explicitly with --data ./examples/demo-knowledge.
Mutating commands targeting the included example workspace additionally require --allow-demo-write.
apply, task, and run commands accept --expected-revision <revision> to reject stale observations.
apply requires a V2 observation envelope. Feature metadata, scenarios, inventory, frontier, and runs
merge by stable ID; journeys merge by ID and activity events append in one revision. Never include
credentials in evidence.`); }
export async function runKnowledgeCli(argv, options = {}) {
  const cliArgv = ['node', 'knowledge.mjs', ...argv];
  const cliCwd = path.resolve(options.cwd ?? process.cwd());
  const stdout = options.stdout ?? ((text) => process.stdout.write(text));
  const stderr = options.stderr ?? ((text) => process.stderr.write(text));
  const print = (...values) => stdout(values.map(String).join(' ') + '\n');
  const readInputJson = (file) => readJsonObject(path.resolve(cliCwd, file));
  const arg = (name) => { const i = cliArgv.indexOf(name); return i < 0 ? undefined : cliArgv[i+1]; };
  const expectedRevision = () => { if (!cliArgv.includes('--expected-revision')) return undefined; const revision = arg('--expected-revision'); if (!revision || revision.startsWith('--')) throw new Error('--expected-revision requires a revision ID.'); return revision; };
  try {
  const [cmd, operand] = cliArgv.slice(2);
  if (!cmd || ['help','-h','--help'].includes(cmd)) { help(print); return 0; }
  if (cmd === 'doctor') {
    if (!cliArgv.includes('--browser')) throw new Error('Usage: doctor --browser <agent-browser-executable> [--mode isolated|attach|profile|restore] [--allowed-domains] [--json]');
    const executable = arg('--browser');
    if (!executable || executable.startsWith('--')) throw new Error('doctor --browser requires an executable path or command.');
    const inspection = await inspectBrowserCli(executable);
    const mode = arg('--mode') ?? 'isolated';
    const modeResult = validateBrowserMode({ mode, allowedDomains: cliArgv.includes('--allowed-domains') }, inspection.capabilities ?? {});
    const result = { ok: inspection.diagnostics.length === 0 && modeResult.valid, browserInfo: browserInfoFromInspection(inspection), diagnostics: [...inspection.diagnostics, ...modeResult.diagnostics], mode: modeResult.mode };
    print(cliArgv.includes('--json') ? JSON.stringify(result, null, 2) : `agent-browser ${result.browserInfo.version ?? 'unavailable'}\nCapabilities: ${JSON.stringify(result.browserInfo.capabilities)}\n${result.diagnostics.length ? result.diagnostics.map((item) => `- ${item.code}: ${item.message}`).join('\n') : `Mode ${mode}: supported`}`);
    return result.ok ? 0 : 1;
  }
  const dataArg = arg('--data');
  const configuredData = dataArg
    ? path.resolve(cliCwd, dataArg)
    : process.env.KNOWLEDGE_DIR
      ? path.resolve(cliCwd, process.env.KNOWLEDGE_DIR)
      : undefined;
  if (!configuredData) throw new Error(`${cmd} requires --data or KNOWLEDGE_DIR to select a workspace.`);
  const dir = workspacePath(configuredData);
  const mutating = ['init', 'apply', 'migrate', 'export', 'diagnostic', 'draft'].includes(cmd) || cmd === 'task' || cmd === 'run' || (cmd === 'coverage' && cliArgv[3] === 'reconcile');
  if (mutating && dir === DEMO_PATH && !cliArgv.includes('--allow-demo-write')) throw new Error('Writing the example workspace requires --allow-demo-write');
  switch (cmd) {
    case 'work': {
      const packet = getWorkPacket(dir, { contextId: arg('--context'), runId: arg('--run') });
      print(cliArgv.includes('--json') ? JSON.stringify(packet, null, 2) : JSON.stringify(packet, null, 2));
      break;
    }
    case 'draft': {
      const packetFile = arg('--packet'); const outputFile = arg('--output');
      if (!packetFile || !outputFile) throw new Error('Usage: draft --packet <packet.json> --output <observation.json> --data ./my-app');
      const draft = createDraft(readInputJson(packetFile), { workspaceDir: dir });
      writeJsonUtf8(path.resolve(cliCwd, outputFile), draft);
      print(JSON.stringify({ output: outputFile, baseRevision: draft.baseRevision, selectedTaskIds: draft.selectedTaskIds || [] }, null, 2));
      break;
    }
    case 'init': print('Created workspace:', initWorkspace(dir, arg('--name'), arg('--url'))); break;
    case 'migrate': print('Migrated:', JSON.stringify(migrateWorkspace(dir), null, 2)); break;
    case 'summary': { const data = loadWorkspace(dir); print(JSON.stringify({ app: data.app, schemaVersion: data.schemaVersion, revision: data.revision, ...summary(data) }, null, 2)); break; }
    case 'next': {
      if (cliArgv.includes('--context')) throw new Error('next does not support --context. Use work --context <id> to select context-scoped work.');
      const data = loadWorkspace(dir);
      if (data.schemaVersion !== 2) {
        const work = tasks(data);
        if (cliArgv.includes('--json')) print(JSON.stringify(work, null, 2));
        else work.length ? work.forEach((t,i) => print(`${i+1}. [${t.status}] ${t.featureTitle} — ${t.goal}\n   ${t.reason}`)) : print('No queued actions.');
        break;
      }
      const coverage = auditCoverage(data);
      const now = new Date().toISOString();
      const activeRuns = (data.runs || []).filter((run) => ['running', 'waiting_user', 'waiting_external'].includes(run.status))
        .map((run) => ({ run, state: deriveRunState(run, data.frontier, now, { contexts: data.contexts, inventory: data.inventory, coverage }) }));
      const liveTaskIds = liveOwnedTaskIds(data.runs, data.frontier, now, { contexts: data.contexts, inventory: data.inventory, coverage });
      const selected = selectNextUnowned(data.frontier, data.contexts, now, data.runs, { contexts: data.contexts, inventory: data.inventory, coverage });
      const readiness = frontierSummary(data.frontier, data.contexts, now, data.inventory, { coverage });
      if (!selected && liveTaskIds.size && ['ready', 'interrupted'].includes(readiness.state)) {
        readiness.state = 'running';
        readiness.reason = 'Ready work is currently owned by a run with a fresh heartbeat.';
      }
      const prerequisites = selected ? selected.dependencies.filter((id) => data.frontier.tasks.find((item) => item.id === id)?.status !== 'done') : [];
      readiness.recoverableTaskIds = readiness.recoverableTaskIds.filter((taskId) => !liveTaskIds.has(taskId));
      const result = {
        task: selected ? { ...selected, context: data.contexts.find((context) => context.id === selected.contextId) || null } : null,
        reason: selected ? { code: 'minimum_depth_fifo', text: 'Ready task with the smallest known graph depth; FIFO among peers.', depth: selected.depth,
          sequence: selected.sequence, contextId: selected.contextId || null, prerequisites, checkpoint: selected.checkpoint ?? null } :
          { code: readiness.state, text: readiness.reason, prerequisites: [] },
        frontier: { ...readiness, activeRuns: activeRuns.map(({ run, state }) => ({ id: run.id, status: state.status, currentTaskId: run.currentTaskId, heartbeatAt: run.effectiveHeartbeatAt ?? run.heartbeatAt, stale: state.stale })) },
      };
      if (cliArgv.includes('--json')) print(JSON.stringify(result, null, 2));
      else if (selected) print(`[${selected.status}] ${selected.goal}\nDepth ${selected.depth}; sequence ${selected.sequence}; ${result.reason.text}${selected.checkpoint ? `\nCheckpoint: ${JSON.stringify(selected.checkpoint)}` : ''}`);
      else print(`${readiness.state}: ${readiness.reason}`);
      break;
    }
    case 'task': {
      const [, action, id, file] = cliArgv.slice(2);
      const revision = expectedRevision();
      if (!['start', 'checkpoint', 'finish', 'block', 'resume'].includes(action) || !id || id.startsWith('-')) {
        throw new Error('Usage: task start <id> | checkpoint <id> <file.json> | finish <id> <file.json> | block <id> <file.json> | resume <id> --data ./my-app');
      }
      const data = loadWorkspace(dir);
      if (data.schemaVersion !== 2) throw new Error('Task lifecycle writes require a migrated V2 workspace.');
      const current = data.frontier.tasks.find((task) => task.id === id);
      if (!current) throw new Error(`Unknown task: ${id}`);
      const now = new Date().toISOString();
      const coverage = auditCoverage(data);
      const freshOwners = liveOwnedTaskIds(data.runs, data.frontier, now, { contexts: data.contexts, inventory: data.inventory, coverage });
      if (action === 'resume' && freshOwners.has(id)) throw new Error(`Cannot resume task ${id}: a fresh run owns it.`);
      let payload = {};
      if (['checkpoint', 'finish', 'block'].includes(action)) {
        if (!file || file.startsWith('-')) throw new Error(`Usage: task ${action} <id> <file.json>`);
        payload = readInputJson(file);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Task lifecycle file must contain a JSON object.');
      }
      const envelope = payload.version === 2 ? payload : payload.observation?.version === 2 ? payload.observation : {};
      if (envelope.version === 2 && !envelope.baseRevision && !revision) throw new Error('Prepared V2 observation requires baseRevision or matching --expected-revision.');
      if (envelope.version === 2 && revision && envelope.baseRevision && envelope.baseRevision !== revision) throw new Error('expectedRevision conflicts with observation.baseRevision');
      let changes = {};
      if (action === 'start') {
        const selected = selectNextUnowned(data.frontier, data.contexts, now, data.runs, { contexts: data.contexts, inventory: data.inventory });
        if (!selected || selected.id !== id) throw new Error(`Task is not the next ready task${selected ? `; next is ${selected.id}` : ''}.`);
        changes = { status: 'running', attempts: current.attempts + 1, lastProgressAt: new Date().toISOString() };
      } else if (action === 'checkpoint') {
        if (current.status !== 'running') throw new Error('Only a running task can be checkpointed.');
        changes = { checkpoint: payload.checkpoint ?? (payload.version === 2 || payload.observation ? current.checkpoint : payload), lastProgressAt: new Date().toISOString() };
      } else if (action === 'finish') {
        if (current.status !== 'running') throw new Error('Only a running task can be finished.');
        const result = payload.checkpoint ?? (payload.version === 2 || payload.observation ? current.checkpoint : payload);
        changes = { status: 'done', ...(result != null ? { checkpoint: result } : {}), lastProgressAt: new Date().toISOString() };
      } else if (action === 'block') {
        const blocker = payload.blocker || (payload.version === 2 || payload.observation ? null : payload);
        if (!blocker) throw new Error('Task block file must contain a blocker object.');
        const status = payload.status || 'blocked';
        if (!['blocked', 'waiting_user', 'waiting_external'].includes(status)) throw new Error('Task block status must be blocked, waiting_user, or waiting_external.');
        changes = { status, blocker, lastProgressAt: new Date().toISOString() };
      } else {
        if (!['blocked', 'waiting_user', 'waiting_external', 'running'].includes(current.status)) throw new Error(`Task in ${current.status} status cannot be resumed.`);
        changes = { status: 'queued', blocker: null, lastProgressAt: new Date().toISOString() };
      }
      const updated = transitionTask(data.frontier, id, { ...changes, ...(action === 'resume' ? { continuation: true } : {}) }).tasks.find((task) => task.id === id);
      const timestamp = new Date().toISOString();
      const owner = (data.runs || []).find((run) => run.currentTaskId === id && ['running', 'waiting_user', 'waiting_external'].includes(run.status) && !deriveRunState(run, data.frontier, new Date(), { contexts: data.contexts, inventory: data.inventory, coverage }).stale);
      const availableRun = action === 'start' || action === 'resume' ? (data.runs || []).find((run) => !run.currentTaskId && ['running', 'waiting_user', 'waiting_external'].includes(run.status) && !deriveRunState(run, data.frontier, new Date(), { contexts: data.contexts, inventory: data.inventory, coverage }).stale) : null;
      const linkedRun = owner || availableRun;
      const staleOwners = action === 'resume' ? (data.runs || []).filter((run) => run.currentTaskId === id && ['running', 'waiting_user', 'waiting_external'].includes(run.status) && deriveRunState(run, data.frontier, now, { contexts: data.contexts, inventory: data.inventory, coverage }).stale).map((run) => ({ ...run, leaseId: run.leaseId, currentTaskId: null, status: 'interrupted', stateReason: `Task ${id} recovered after run heartbeat expiry.` })) : [];
      const runs = [...staleOwners, ...(linkedRun ? [{ ...linkedRun, leaseId: linkedRun.leaseId,
        currentTaskId: ['done', 'blocked', 'waiting_user', 'waiting_external'].includes(updated.status) ? null : id,
        status: updated.status === 'blocked' ? 'interrupted' : updated.status === 'waiting_user' ? 'waiting_user' : updated.status === 'waiting_external' ? 'waiting_external' : 'running',
        stateReason: updated.status === 'blocked' ? `Task ${id} is blocked: ${updated.blocker?.reason || 'required change is unresolved'}` : null,
        ...(action === 'checkpoint' ? { checkpoint: updated.checkpoint } : {}),
      }] : [])];
      const eventType = action === 'start' || action === 'resume' ? 'task_started' : action === 'checkpoint' ? 'task_checkpointed' : action === 'finish' ? 'task_finished' : 'task_waiting';
      const events = linkedRun ? [{ id: `event.${randomUUID()}`, runId: linkedRun.id, taskId: id, type: eventType, timestamp,
        message: action === 'checkpoint' ? `Checkpoint saved for task ${id}.` : action === 'finish' ? `Finished task ${id}.` : action === 'block' ? `Task ${id} is waiting or blocked.` : `Started task ${id}.` }] : [];
      const incomingTasks = envelope.frontier?.tasks || [];
      const observation = { ...envelope, version: 2, runs: [...(envelope.runs || []).filter((run) => run.id !== linkedRun?.id && !staleOwners.some((stale) => stale.id === run.id)), ...runs], events: [...(envelope.events || []), ...events], frontier: { ...(envelope.frontier || {}), tasks: [...incomingTasks.filter((task) => task.id !== id), updated] } };
      const receipt = applyObservation(dir, observation, { expectedRevision: revision ?? envelope.baseRevision ?? data.revision, beforeCurrent: action === 'resume' && staleOwners.length ? () => fenceStaleRunRecovery(dir, staleOwners.map((run) => run.id), now, { contexts: data.contexts, inventory: data.inventory, coverage, staleAfterMs: runHeartbeatThresholdMs() }) : undefined });
      const result = { id, status: updated.status, sequence: updated.sequence, receipt, work: getWorkPacket(dir, linkedRun ? { runId: linkedRun.id } : {}) };
      print(JSON.stringify(result, null, 2));
      break;
    }
    case 'diagnostic': {
      const [, action, file] = cliArgv.slice(2);
      if (action === 'list') print(JSON.stringify(readDiagnostics(dir), null, 2));
      else {
        if (action !== 'record' || !file || file.startsWith('-')) throw new Error('Usage: diagnostic record <event.json> | list --json --data ./my-app');
        const event = readInputJson(file);
        print(JSON.stringify(await recordDiagnostic(dir, event)));
      }
      break;
    }
    case 'run': {
      const [, action, id, file] = cliArgv.slice(2);
      const revision = expectedRevision();
      if (action === 'start') {
        if (!id || id.startsWith('-')) throw new Error('Usage: run start <scope-file.json> [--browser <executable>] [--session <alias>] --data ./my-app');
        const scope = readInputJson(id);
        if (!scope || typeof scope !== 'object' || Array.isArray(scope)) throw new Error('Run scope file must contain a JSON object.');
        let browserInfo = null;
        const executable = arg('--browser');
        if (executable) browserInfo = browserInfoFromInspection(await inspectBrowserCli(executable));
        const result = startRun(dir, scope, browserInfo, { expectedRevision: revision, browserSessionAlias: arg('--session') });
        print(cliArgv.includes('--json') ? JSON.stringify(result, null, 2) : `Run started: ${JSON.stringify(result, null, 2)}`);
      } else if (action === 'checkpoint') {
        if (!id || !file || file.startsWith('--')) throw new Error('Usage: run checkpoint <id> <file.json> --data ./my-app');
        const checkpoint = readInputJson(file);
        const result = checkpointRun(dir, id, checkpoint, { expectedRevision: revision });
        const output = { ...result, work: getWorkPacket(dir, { runId: id }) };
        print(cliArgv.includes('--json') ? JSON.stringify(output, null, 2) : `Run checkpointed: ${JSON.stringify(output, null, 2)}`);
      } else if (action === 'heartbeat') {
        if (!id || id.startsWith('-')) throw new Error('Usage: run heartbeat <id> --data ./my-app');
        const leaseId = arg('--lease');
        if (!leaseId) throw new Error('Usage: run heartbeat <id> --lease <lease-id> [--task <task-id>] --data ./my-app');
        const result = await heartbeatRun(dir, id, { leaseId, taskId: arg('--task') });
        print(cliArgv.includes('--json') ? JSON.stringify(result, null, 2) : `Run heartbeat: ${JSON.stringify(result, null, 2)}`);
      } else if (action === 'advance') {
        if (!id || !file || file.startsWith('--')) throw new Error('Usage: run advance <id> <observation.json> --lease <id> --request-id <id> [--expected-revision <revision>] --data ./my-app');
        const leaseId = arg('--lease'); const requestId = arg('--request-id');
        if (!leaseId || !requestId) throw new Error('run advance requires --lease and --request-id.');
        const observation = readInputJson(file);
        const result = advanceRun(dir, id, observation, { expectedRevision: revision, requestId, leaseId });
        print(JSON.stringify(result, null, 2));
      } else if (action === 'stop') {
        const reason = cliArgv.slice(5).filter((value, index, values) => value !== '--data' && value !== '--expected-revision' && !values[index - 1]?.startsWith('--') && !value.startsWith('--')).join(' ');
        if (!id || !reason) throw new Error('Usage: run stop <id> <reason> --data ./my-app');
        const result = stopRun(dir, id, reason, { expectedRevision: revision });
        const output = { ...result, work: getWorkPacket(dir, { runId: id }) };
        print(cliArgv.includes('--json') ? JSON.stringify(output, null, 2) : `Run stopped: ${JSON.stringify(output, null, 2)}`);
      } else throw new Error('Usage: run start <scope-file> | checkpoint <id> <file> | heartbeat <id> | stop <id> <reason> --data ./my-app');
      break;
    }
    case 'apply': {
      if (!operand || operand.startsWith('-')) throw new Error('Usage: apply observation.json --data ./my-app');
      const observation = readInputJson(operand);
      const receipt = applyObservation(dir, observation, { expectedRevision: expectedRevision() });
      print(JSON.stringify({ receipt, work: getWorkPacket(dir) }, null, 2));
      break;
    }
    case 'feature': {
      const [, action, id] = cliArgv.slice(2);
      if (action !== 'get' || !id || id.startsWith('-')) throw new Error('Usage: feature get <id> --data ./my-app [--json]');
      const result = getFeature(dir, id);
      print(cliArgv.includes('--json') ? JSON.stringify(result, null, 2) : JSON.stringify(result.feature, null, 2));
      break;
    }
    case 'coverage': {
      const action = cliArgv[3];
      if (action === 'audit') {
        const data = loadWorkspace(dir);
        const contextId = arg('--context');
        if (contextId && !data.contexts.some((context) => context.id === contextId)) throw new Error(`Unknown context: ${contextId}`);
        const result = auditCoverage(data, contextId ? { contextIds: [contextId] } : {});
        print(cliArgv.includes('--json') ? JSON.stringify({ revision: data.revision, ...result }, null, 2) : `${result.state}: ${result.counts.gaps} gap(s)`);
      } else if (action === 'reconcile') {
        const result = await reconcileCoverage(dir, { contextId: arg('--context'), expectedRevision: expectedRevision() });
        print(JSON.stringify({ ...result, work: getWorkPacket(dir, { contextId: arg('--context') }) }, null, 2));
      } else throw new Error('Usage: coverage audit | coverage reconcile --context <id> --expected-revision <revision> --data ./my-app');
      break;
    }
    case 'check': print('Workspace valid:', JSON.stringify(checkWorkspace(dir))); break;
    case 'export': print('Markdown export:', JSON.stringify(exportDocs(dir, { force: cliArgv.includes('--force'), check: cliArgv.includes('--check') }), null, 2)); break;
    default: throw new Error(`Unknown command: ${cmd}`);
  }
  } catch (error) { stderr('ERROR: ' + error.message + '\n'); return 1; }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runKnowledgeCli(process.argv.slice(2));
}
