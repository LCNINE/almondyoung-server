import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

/**
 * 두 실행이 겹치면 한쪽의 되돌리기가 다른 쪽이 막 만든 DB 를 지운다. pid 파일로 막는다 — 주인이 죽었으면 넘겨받는다.
 * (flock 은 macOS 에 없다.)
 */
export function takeRunLock(path: string): () => void {
  const take = () => writeFileSync(path, String(process.pid), { flag: 'wx' });
  try {
    take();
  } catch {
    const owner = Number(readFileSync(path, 'utf8'));
    if (owner && isAlive(owner)) throw new Error(`이미 돌고 있다 (pid ${owner}) — 끝난 뒤 다시 돌릴 것`);
    unlinkSync(path);
    take();
  }
  return () => {
    if (existsSync(path) && readFileSync(path, 'utf8') === String(process.pid)) unlinkSync(path);
  };
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
