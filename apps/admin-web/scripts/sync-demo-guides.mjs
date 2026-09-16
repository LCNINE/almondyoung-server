import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(appRoot, '../../docs/demo-training');
const target = resolve(appRoot, 'demo-guides');
await rm(target, { recursive: true, force: true });
if (process.env.APP_STAGE === 'demo') {
  await mkdir(target, { recursive: true });
  // Ship only reviewed guide output, never scratch state, build tools or credentials.
  const copyPublicArtifacts = async (from, to) => {
    for (const entry of await readdir(from, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const src = resolve(from, entry.name), dst = resolve(to, entry.name);
      if (entry.isDirectory()) { await mkdir(dst, { recursive: true }); await copyPublicArtifacts(src, dst); }
      else if (/\.(html|css|js|png|jpe?g|svg|pdf|woff2?)$/.test(entry.name)) await cp(src, dst);
    }
  };
  await copyPublicArtifacts(source, target);
}
