import { resolve } from 'node:path';
import {readFile} from 'node:fs/promises';
import { runKnowledgeCli } from '../../packages/app-explorer/index.mjs';
import { listApps, registerApp, registerSourceAlias, resolveAppWorkspace, resolveSourceAlias } from './registry.js';
import {registerSession} from '../browser-session/registry.js';
import {promoteExplorerEvidence} from './promote.js';

type Print = (value: unknown) => void;
function option(args: string[], key: string): string | undefined {
  const i = args.indexOf(key);
  return i < 0 ? undefined : args[i + 1];
}
function requireOption(args: string[], key: string): string {
  const value = option(args, key);
  if (!value || value.startsWith('--')) throw new Error(`${key} requires a value.`);
  return value;
}
function assertOptions(args: string[], firstOption: number, allowed: string[]): void {
  const seen = new Set<string>();
  for (let i = firstOption; i < args.length;) {
    const key = args[i];
    if (!allowed.includes(key)) throw new Error(`Unsupported option: ${key}`);
    if (seen.has(key)) throw new Error(`Option may only be specified once: ${key}`);
    const value = args[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`${key} requires a value.`);
    seen.add(key);
    i += 2;
  }
}
function takeSingleOption(args: string[], key: string): { value?: string; rest: string[] } {
  const indexes = args.flatMap((value, index) => value === key ? [index] : []);
  if (indexes.length > 1) throw new Error(`${key} may only be specified once.`);
  if (!indexes.length) return { rest: args };
  const index = indexes[0];
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${key} requires a value.`);
  return { value, rest: [...args.slice(0, index), ...args.slice(index + 2)] };
}
function fail(print: Print, error: unknown): number {
  print(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  return 1;
}

async function validateObservationSourceAliases(root: string, appId: string, args: string[]): Promise<void> {
  const source = args[0] === 'apply' ? args[1] : args[0] === 'run' && args[1] === 'advance' ? args[3] : undefined;
  if (!source || source.startsWith('--')) return;
  const observation = JSON.parse(await readFile(resolve(root, source), 'utf8')) as Record<string, any>;
  for (const feature of observation.features || []) for (const candidate of feature.research?.sourceCandidates || []) {
    await resolveSourceAlias(root, appId, candidate.sourceAlias);
  }
}

export async function handleExplorerCli(root: string, argv: string[], print: Print): Promise<number> {
  try {
    if(argv[0]==='evidence'&&argv[1]==='materialize'){
      const selectionFile=argv[2];if(!selectionFile||selectionFile.startsWith('--'))throw new Error('Usage: explore evidence materialize <selection.json> --app <id>');
      assertOptions(argv,3,['--app']);const appId=requireOption(argv,'--app');
      let selection:Record<string,unknown>;try{selection=JSON.parse(await readFile(resolve(root,selectionFile),'utf8')) as Record<string,unknown>;}catch(error){throw new Error(`Could not read Explorer promotion selection JSON: ${error instanceof Error?error.message:String(error)}`);}
      if(selection.appId!==undefined&&selection.appId!==appId)throw new Error('Selection appId does not match --app.');
      print({ok:true,...await promoteExplorerEvidence(root,{...selection,appId} as any)});return 0;
    }
    if(argv[0]==='sessions'&&argv[1]==='register'){
      assertOptions(argv,2,['--app','--context','--session','--role']);
      const result=await registerSession(root,{appId:requireOption(argv,'--app'),contextId:requireOption(argv,'--context'),sessionName:requireOption(argv,'--session'),...(option(argv,'--role')?{role:option(argv,'--role')}: {})});
      print({ok:true,handle:result.handle});return 0;
    }
    if (argv[0] === 'apps') {
      if (argv[1] === 'list' && argv.length === 2) {
        print({ apps: await listApps(root) });
        return 0;
      }
      if (argv[1] === 'add') {
        assertOptions(argv, 2, ['--id', '--name', '--url']);
        const registration = await registerApp(root, { id: requireOption(argv, '--id'), name: requireOption(argv, '--name'), url: requireOption(argv, '--url') });
        print({ ok: true, appId: registration.id });
        return 0;
      }
      if (argv[1] === 'source' && argv[2] === 'add') {
        assertOptions(argv, 3, ['--app', '--alias', '--path']);
        const appId = requireOption(argv, '--app');
        const alias = requireOption(argv, '--alias');
        await addSource(root, appId, alias, requireOption(argv, '--path'));
        print({ ok: true, appId, alias });
        return 0;
      }
      throw new Error('Usage: explore apps add --id <id> --name <name> --url <url> | apps list | apps source add --app <id> --alias <alias> --path <supplied-root> | evidence materialize <selection.json> --app <id> | sessions register --app <id> --context <id> --session <owner-alias> [--role <role>]');
    }

    const appArg = takeSingleOption(argv, '--app');
    const args = appArg.rest;
    const dataArg = takeSingleOption(args, '--data');
    if (appArg.value && dataArg.value) throw new Error('Use either --app or --data, not both.');
    if (!appArg.value && !dataArg.value && (argv.length === 0 || ['-h', '--help', 'help'].includes(argv[0]))) {
      return await runKnowledgeCli(argv, { cwd: root, stdout: printLine(print), stderr: printLine(print) });
    }
    if (!appArg.value && !dataArg.value) throw new Error('Choose a registered app with --app <id> or an explicit dataset with --data <path>.');
    if (appArg.value) {
      await validateObservationSourceAliases(root, appArg.value, dataArg.rest);
      const directory = await resolveAppWorkspace(root, appArg.value);
      return await runKnowledgeCli([...dataArg.rest, '--data', directory], { cwd: root, stdout: printLine(print), stderr: printLine(print) });
    }
    return await runKnowledgeCli(argv, { cwd: root, stdout: printLine(print), stderr: printLine(print) });
  } catch (error) {
    return fail(print, error);
  }
}

function printLine(print: Print) { return (text: string) => print(text.trimEnd()); }
async function addSource(root: string, appId: string, alias: string, path: string): Promise<void> {
  await registerSourceAlias(root, appId, { alias, path: resolve(path) });
}
