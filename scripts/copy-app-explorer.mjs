import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'packages', 'app-explorer');
const distRoot = path.join(root, 'dist');
const target = path.resolve(distRoot, 'packages', 'app-explorer');
const relativeTarget = path.relative(distRoot, target);
if (!relativeTarget || relativeTarget.startsWith(`..${path.sep}`) || path.isAbsolute(relativeTarget)) {
  throw new Error(`Refusing to copy App Explorer outside dist: ${target}`);
}

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, {
  recursive: true,
  filter(file) {
    const relative = path.relative(source, file).split(path.sep).join('/');
    return !relative.startsWith('tests/') && !relative.startsWith('docs/') && !relative.startsWith('skills/');
  },
});
