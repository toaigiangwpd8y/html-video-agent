import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { inspectBrowserCli, validateBrowserMode, normalizeBrowserError } from '../lib/browser-capabilities.mjs';

function fakeRunner(responses) {
  return (_executable, args) => {
    const key = args.join(' ');
    if (!(key in responses)) throw new Error(`Unexpected command: ${key}`);
    const value = responses[key];
    if (value instanceof Error) throw value;
    return value;
  };
}

test('inspectBrowserCli reports a missing executable as a diagnostic', async () => {
  const result = await inspectBrowserCli('missing-agent-browser', {
    run: () => { throw Object.assign(new Error('not found'), { code: 'ENOENT' }); },
  });
  assert.equal(result.version, null);
  assert.equal(result.capabilities, null);
  assert.equal(result.diagnostics[0].code, 'executable_missing');
});

test('inspectBrowserCli rejects a release older than the supported minimum', async () => {
  const result = await inspectBrowserCli('agent-browser', {
    run: fakeRunner({
      '--version': { status: 0, stdout: 'agent-browser 0.38.0', stderr: '' },
      '--help': { status: 0, stdout: '--session --restore --profile --allowed-domains', stderr: '' },
    }),
  });
  assert.equal(result.version, '0.38.0');
  assert.equal(result.capabilities.session, true);
  assert.ok(result.diagnostics.some((item) => item.code === 'version_too_old'));
});

test('inspectBrowserCli marks required flags unsupported when help omits them', async () => {
  const result = await inspectBrowserCli('agent-browser', {
    run: fakeRunner({
      '--version': { status: 0, stdout: 'agent-browser 0.39.1', stderr: '' },
      '--help': { status: 0, stdout: 'agent-browser commands --session', stderr: '' },
    }),
  });
  assert.equal(result.capabilities.snapshot, false);
  assert.ok(result.diagnostics.some((item) => item.code === 'capability_missing' && item.capability === 'snapshot'));
});

test('validateBrowserMode rejects allowed-domains with attach, profile, or restore', () => {
  for (const mode of ['attach', 'profile', 'restore']) {
    const result = validateBrowserMode({ mode, allowedDomains: true }, {});
    assert.equal(result.valid, false);
    assert.equal(result.diagnostics[0].code, 'allowed_domains_incompatible');
  }
});

test('validateBrowserMode rejects requested allowed-domains when the CLI does not support it', () => {
  const result = validateBrowserMode({ mode: 'isolated', allowedDomains: true }, { session: true, allowedDomains: false });
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code, 'allowed_domains_unsupported');
});

test('doctor JSON reports unsupported requested allowed-domains as a failed preflight', () => {
  const result = spawnSync(process.execPath, [
    'tools/knowledge.mjs', 'doctor', '--browser', 'missing-agent-browser-for-doctor-test',
    '--mode', 'isolated', '--allowed-domains', '--json',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.ok(output.diagnostics.some((item) => item.code === 'allowed_domains_unsupported'));
});

test('validateBrowserMode reports missing required mode capabilities', () => {
  const result = validateBrowserMode({ mode: 'restore', allowedDomains: false }, { restore: false });
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code, 'mode_capability_missing');
});

test('validateBrowserMode accepts CDP attach when its capability exists', () => {
  assert.deepEqual(validateBrowserMode({ mode: 'attach' }, { cdp: true }), { valid: true, mode: 'attach', diagnostics: [] });
});

test('normalizeBrowserError identifies outcome_unknown and directs state inspection without replay', () => {
  const result = normalizeBrowserError({ code: 'outcome_unknown', message: 'timed out' });
  assert.equal(result.code, 'outcome_unknown');
  assert.equal(result.recovery, 'inspect_state');
  assert.equal(result.replay, false);
});

test('normalizeBrowserError identifies tab_gone and does not replay the attempted action', () => {
  const result = normalizeBrowserError({ code: 'tab_gone', message: 'tab closed' });
  assert.equal(result.code, 'tab_gone');
  assert.equal(result.recovery, 'select_or_reopen_tab');
  assert.equal(result.replay, false);
});
