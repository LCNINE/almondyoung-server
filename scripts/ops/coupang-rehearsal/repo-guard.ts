import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { realpathSync } from 'fs';

/** 순수 판정: `target` 이 `repoTop` 와 같거나 그 아래인가(둘 다 realpath 로 푼 절대경로). `<repo>/..raw` 는 안쪽이다. */
export function isInsideRepo(repoTop: string, target: string): boolean {
  const rel = relative(repoTop, target);
  if (rel === '') return true;
  if (rel === '..' || rel.startsWith(`..${sep}`)) return false;
  return !isAbsolute(rel);
}

/** 아직 없는 경로도 가장 가까운 존재하는 조상의 realpath 로 풀어 심볼릭 링크로 레포 안에 들어오는 것을 막는다. */
export function realpathLoose(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    const parent = dirname(absolute);
    if (parent === absolute) return absolute;
    return join(realpathLoose(parent), basename(absolute));
  }
}
