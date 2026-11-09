import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

type Identity = { dev: number; ino: number; mode: number; size: number; mtimeMs: number };
export type ConfinedReadOptions = { beforeOpen?: () => void | Promise<void> };

function isWithin(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function identity(info: Identity): string {
  return `${info.dev}:${info.ino}:${info.mode}:${info.size}:${info.mtimeMs}`;
}

/** Read bytes through one validated file handle; no later path reopen can escape the checked tree. */
export async function readConfinedFile(root: string, relativePath: string, options: ConfinedReadOptions = {}): Promise<Buffer> {
  const normalized = relativePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (!normalized || normalized.includes('\0') || parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) {
    throw new Error('Unsafe relative file path.');
  }
  const base = resolve(root);
  const rootInfo = await lstat(base);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Confined file root must be a real directory.');
  const rootReal = await realpath(base);
  if (rootReal !== base) throw new Error('Confined file root path changed.');
  const paths = [base];
  for (const part of parts) paths.push(join(paths.at(-1)!, part));
  const before: Identity[] = [];
  for (const [index, path] of paths.entries()) {
    const info = await lstat(path);
    if (info.isSymbolicLink() || (index < paths.length - 1 ? !info.isDirectory() : !info.isFile())) throw new Error('Confined file path contains a symlink or invalid entry.');
    before.push(info);
    const currentReal = await realpath(path);
    if (!isWithin(rootReal, currentReal) || (index === 0 && currentReal !== rootReal)) throw new Error('Confined file path escaped its root.');
  }

  await options.beforeOpen?.();
  const target = paths.at(-1)!;
  const noFollow = process.platform === 'win32' ? 0 : (constants.O_NOFOLLOW ?? 0);
  const handle = await open(target, constants.O_RDONLY | noFollow);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || identity(opened) !== identity(before.at(-1)!)) throw new Error('Confined file changed before it could be read.');
    for (let index = 0; index < paths.length; index++) {
      const current = await lstat(paths[index]!);
      if (current.isSymbolicLink() || identity(current) !== identity(before[index]!) ||
          (index < paths.length - 1 ? !current.isDirectory() : !current.isFile())) {
        throw new Error('Confined file path changed before it could be read.');
      }
      const currentReal = await realpath(paths[index]!);
      if (!isWithin(rootReal, currentReal) || (index === 0 && currentReal !== rootReal)) throw new Error('Confined file path escaped its root.');
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
