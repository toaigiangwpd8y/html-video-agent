import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import test from 'node:test';

const root = resolve('.');
const read = (path: string) => readFile(join(root, path), 'utf8');

test('App Explorer activates only on explicit exploration requests and has no fixed discovery quotas', async () => {
  const skill = await read('.agents/skills/app-explorer/SKILL.md');
  assert.match(skill, /explicit(?:ly)? (?:user )?request/i);
  assert.match(skill, /minimum (?:semantic )?depth.*FIFO|BFS.*FIFO/i);
  assert.doesNotMatch(skill, /\b(?:60 actions?|20 minutes?|two passes?|max(?:imum)? \d+ (?:clicks?|features?|steps?))\b/i);
});

test('video skills route to known Explorer workflows without automatic exploration', async () => {
  const [video, demo, ad] = await Promise.all([read('.agents/skills/agent-video/SKILL.md'), read('.agents/skills/video-types/product-demo/SKILL.md'), read('.agents/skills/video-types/product-ad/SKILL.md')]);
  assert.match(video, /explicit user request/i);
  assert.match(demo, /read the known, selected workflows from the registered App Explorer revision/i);
  assert.match(demo, /knowledge is missing.*report.*user request/i);
  assert.doesNotMatch(demo, /live-first inspection is the default/i);
  assert.match(ad, /Main\/supporting video-selection labels.*only/i);
  assert.doesNotMatch(ad, /automatic product-ad discovery|dialog.{0,40}(?:verified|success)/i);
});

test('pauses and user-enough preserve unknowns, while scoped completion remains distinct', async () => {
  const skill = await read('.agents/skills/app-explorer/SKILL.md');
  assert.match(skill, /pause.*(?:unknown|incomplete|not .*completion)|unknown.*(?:remain|preserv)/is);
  assert.match(skill, /user.*enough.*(?:preserv|remain open|unknown)/is);
  assert.match(skill, /exhausted_in_scope/);
});

test('production research selection retains the existing post-Storyboard asset gate', async () => {
  const enhance = await read('.agents/skills/storyboard-enhance/SKILL.md');
  assert.match(enhance, /after Storyboard approval/i);
  assert.match(enhance, /asset preflight|preflight.*approval/i);
  assert.match(enhance, /assets\/manifest\.json/);
});

test('dashboards and chat steering remain separate, without a browser-control lock', async () => {
  const [agents, skill] = await Promise.all([read('AGENTS.md'), read('.agents/skills/app-explorer/SKILL.md')]);
  const combined = `${agents}\n${skill}`;
  assert.match(combined, /two dashboards/i);
  assert.match(combined, /chat.*steer|steer.*chat/i);
  assert.doesNotMatch(combined, /(?:must|required to hold|requires holding).*browser.*(?:mutex|lock|lease)|browser-control lease required/i);
});

test('recording guidance separates physical evidence files from canonical refs and preserves incremental receipt semantics', async () => {
  const [skill, workflow, browser] = await Promise.all([
    read('.agents/skills/app-explorer/SKILL.md'),
    read('.agents/skills/app-explorer/references/workflow.md'),
    read('packages/app-explorer/docs/AGENT_BROWSER.md'),
  ]);
  const guidance = `${skill}\n${workflow}\n${browser}`;
  assert.match(guidance, /workspace\/evidence\/<runId>\/\<file\>/);
  assert.match(guidance, /<runId>\/\<file\>.*POSIX separators.*relative to `workspace\/evidence`/s);
  assert.match(guidance, /never include `workspace\/` or `evidence\/`/i);
  assert.match(guidance, /promptly.*(?:do not wait|do not defer).*first semantic apply|do not wait.*first semantic apply/is);
  assert.match(guidance, /checkpoint.*recovery.*does not attach.*semantic observation/is);
  assert.match(guidance, /exact `baseRevision`|exact receipt/is);
  assert.match(guidance, /screenshot.*(?:does not alone prove|proves only).*`?verified`?/is);
  assert.match(guidance, /`discovered`\/?`partial`/);
});
