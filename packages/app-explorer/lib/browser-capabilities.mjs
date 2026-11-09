import { spawnSync } from 'node:child_process';

const MINIMUM_VERSION = '0.39.1';
const FLAG_CAPABILITIES = {
  snapshot: /\bsnapshot\b/i,
  screenshot: /\bscreenshot\b/i,
  session: /--session\b/,
  cdp: /--cdp\b/,
  profile: /--profile\b/,
  restore: /--restore\b/,
  allowedDomains: /--allowed-domains\b/,
  authVault: /\bauth save\b/i,
  pinTab: /--pin-tab\b/,
};

function runProcess(executable, args, timeout = 8000) {
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout, windowsHide: true });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function parseVersion(output) {
  return output.match(/\bagent-browser\s+v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i)?.[1] ?? null;
}

function compareVersions(a, b) {
  const parts = (value) => value.split(/[.+-]/).slice(0, 3).map(Number);
  const left = parts(a), right = parts(b);
  for (let i = 0; i < 3; i += 1) {
    if ((left[i] || 0) !== (right[i] || 0)) return (left[i] || 0) - (right[i] || 0);
  }
  return 0;
}

export async function inspectBrowserCli(executable, options = {}) {
  const diagnostics = [];
  if (!executable || typeof executable !== 'string') {
    return { executable: executable ?? null, version: null, capabilities: null, diagnostics: [{ code: 'executable_missing', message: 'Provide an agent-browser executable path or command.' }] };
  }
  const run = options.run ?? runProcess;
  let versionResult;
  try {
    versionResult = await run(executable, ['--version']);
  } catch (error) {
    const missing = error?.code === 'ENOENT';
    diagnostics.push({ code: missing ? 'executable_missing' : 'version_check_failed', message: missing ? 'agent-browser executable was not found.' : `Could not read agent-browser version: ${error.message}` });
    return { executable, version: null, capabilities: null, diagnostics };
  }
  const version = parseVersion(`${versionResult.stdout}\n${versionResult.stderr}`);
  if (versionResult.status !== 0 || !version) {
    diagnostics.push({ code: 'version_check_failed', message: 'agent-browser did not return a recognizable version.' });
    return { executable, version, capabilities: null, diagnostics };
  }
  if (compareVersions(version, MINIMUM_VERSION) < 0) diagnostics.push({ code: 'version_too_old', minimum: MINIMUM_VERSION, message: `agent-browser ${MINIMUM_VERSION} or newer is required; found ${version}.` });

  let helpResult;
  try {
    helpResult = await run(executable, ['--help']);
  } catch (error) {
    diagnostics.push({ code: 'help_check_failed', message: `Could not inspect agent-browser capabilities: ${error.message}` });
    return { executable, version, capabilities: null, diagnostics };
  }
  const help = `${helpResult.stdout}\n${helpResult.stderr}`;
  if (helpResult.status !== 0 || !help.trim()) {
    diagnostics.push({ code: 'help_check_failed', message: 'agent-browser help did not return usable capability information.' });
    return { executable, version, capabilities: null, diagnostics };
  }
  const capabilities = Object.fromEntries(Object.entries(FLAG_CAPABILITIES).map(([name, pattern]) => [name, pattern.test(help)]));
  for (const capability of ['snapshot', 'screenshot', 'session']) {
    if (!capabilities[capability]) diagnostics.push({ code: 'capability_missing', capability, message: `Required capability is missing: ${capability}.` });
  }
  return { executable, version, capabilities, diagnostics };
}

export function browserInfoFromInspection(inspection) {
  return { version: inspection?.version ?? null, capabilities: inspection?.capabilities ?? null };
}

const MODE_CAPABILITY = { isolated: 'session', attach: 'cdp', profile: 'profile', restore: 'restore' };

export function validateBrowserMode(config = {}, capabilities = {}) {
  const mode = config.mode ?? 'isolated';
  const diagnostics = [];
  if (!(mode in MODE_CAPABILITY)) diagnostics.push({ code: 'mode_unsupported', message: `Unknown browser mode: ${mode}.` });
  if (config.allowedDomains && ['attach', 'profile', 'restore'].includes(mode)) {
    diagnostics.push({ code: 'allowed_domains_incompatible', message: `--allowed-domains cannot be combined with ${mode} mode.` });
  }
  if (config.allowedDomains && capabilities.allowedDomains !== true) {
    diagnostics.push({ code: 'allowed_domains_unsupported', capability: 'allowedDomains', message: 'The installed CLI does not advertise --allowed-domains support.' });
  }
  const required = MODE_CAPABILITY[mode];
  if (required && capabilities[required] !== true) {
    diagnostics.push({ code: 'mode_capability_missing', capability: required, message: `${mode} mode requires the ${required} capability.` });
  }
  return { valid: diagnostics.length === 0, mode, diagnostics };
}

export function normalizeBrowserError(error) {
  const code = error?.code ?? error?.data?.code ?? 'browser_error';
  if (code === 'outcome_unknown') {
    return { code, message: error?.message ?? 'The command outcome is unknown.', recovery: 'inspect_state', replay: false };
  }
  if (code === 'tab_gone') {
    return { code, message: error?.message ?? 'The bound browser tab is gone.', recovery: 'select_or_reopen_tab', replay: false };
  }
  return { code, message: error?.message ?? String(error), recovery: 'inspect_error', replay: false };
}
