import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './json-io.mjs';
import { resolveRevision } from './revisions.mjs';
import { loadWorkspace } from './store.mjs';

export const VALIDATION_VERSION = 1;

export function revisionFiles(dataDir) {
  const files = ['catalog.json', 'inventory.json', 'frontier.json', 'runs.json', 'activity.json'];
  const featureDir = path.join(dataDir, 'features');
  if (fs.existsSync(featureDir)) for (const name of fs.readdirSync(featureDir).sort()) {
    if (name.endsWith('.json')) files.push(path.posix.join('features', name));
  }
  return files;
}

export function readRevisionManifest(dataDir, revision) {
  const file = path.join(dataDir, 'manifest.json');
  if (!fs.existsSync(file)) return null;
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (manifest.version !== 1 || manifest.revision !== revision || !manifest.files || manifest.validationVersion !== VALIDATION_VERSION) {
    throw new Error(`Invalid or stale revision manifest for ${revision}`);
  }
  return manifest;
}

export function verifyRevisionHashes(dataDir, manifest) {
  const actualFiles = revisionFiles(dataDir);
  const expected = Object.keys(manifest.files).sort();
  if (actualFiles.slice().sort().join('\0') !== expected.join('\0')) throw new Error('Revision manifest file inventory mismatch');
  for (const relative of expected) {
    const hash = sha256(fs.readFileSync(path.join(dataDir, relative)));
    if (hash !== manifest.files[relative]) throw new Error(`Revision hash mismatch (tampering detected): ${relative}`);
  }
  return true;
}

export function readIndexedCoverage(dataDir, revision, { verifySources = true } = {}) {
  const manifest = readRevisionManifest(dataDir, revision);
  if (!manifest?.derivedIndexes?.coverage) return null;
  const index = manifest.derivedIndexes.coverage;
  if (index.revision !== revision || !index.sourceHashes) throw new Error(`Coverage index is not bound to CURRENT revision ${revision}`);
  if (verifySources) {
    for (const relative of ['catalog.json', 'inventory.json', 'frontier.json']) {
      const recorded = manifest.files[relative];
      if (!recorded || index.sourceHashes[relative] !== recorded || sha256(fs.readFileSync(path.join(dataDir, relative))) !== recorded) {
        throw new Error(`Revision index source hash mismatch: ${relative}`);
      }
    }
  }
  return structuredClone(index.value);
}


// A server-local reader keeps validated immutable revisions hot between polls.
// CURRENT is still checked each time, so a new atomic receipt invalidates the
// entire cached snapshot before any derived data is reused.
function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function createWorkspaceReader(dataDir, options = {}) {
  const resolve = options.resolveRevision || resolveRevision;
  const load = options.loadWorkspace || loadWorkspace;
  let cached = null;
  const counters = { identityReads: 0, workspaceLoads: 0, cacheHits: 0 };
  const reader = {
    get lastGood() { return cached?.knowledge || null; },
    get counters() { return { ...counters }; },
    readKnowledge() {
      counters.identityReads++;
      const identity = resolve(dataDir);
      if (identity.schemaVersion === 2 && cached?.schemaVersion === identity.schemaVersion && cached?.revision === identity.revision && cached?.dataDir === identity.dataDir) {
        counters.cacheHits++;
        return cached.knowledge;
      }
      // Do not replace last-good on a failed load. Callers surface the failure;
      // a later request can retry the same CURRENT identity.
      const knowledge = load(dataDir);
      counters.workspaceLoads++;
      if (knowledge.schemaVersion !== identity.schemaVersion || knowledge.revision !== identity.revision || knowledge.dataDir !== identity.dataDir) {
        throw new Error('Workspace receipt changed while loading the current revision; retry the read.');
      }
      cached = { ...identity, knowledge: deepFreeze(knowledge) };
      return cached.knowledge;
    },
    invalidate() { cached = null; },
  };
  return reader;
}
