import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { importGraph, type ImportGraph } from '../auth/mutation-guard-graph';

/**
 * 테넌트 셸 게이트 전용(앱 코드가 import 하지 않는다) — 화면 페이지에서 값으로 import 하는 것을 따라가 «그 화면이 싣는 코드»를 모은다.
 * 타입 전용 import 는 빼고, barrel(`export * from`)은 가져온 이름을 선언한 파일로 잇는다(뮤테이션 가드 게이트와 같은 그래프).
 */
export const SRC = join(__dirname, '..', '..');

let graph: ImportGraph | null = null;
export const adminWebGraph = (): ImportGraph => (graph ??= importGraph(SRC));

/** 이 파일(src 기준)이 값으로 닿는 src 파일 전부(자신 포함). */
export function reachableFrom(rel: string): Set<string> {
  const g = adminWebGraph();
  const seen = new Set<string>();
  const queue = [rel];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const next of g.importsOf(file)) if (!seen.has(next)) queue.push(next);
  }
  return seen;
}

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** 주석을 뺀 파일 본문. */
export const codeOf = (rel: string) => strip(adminWebGraph().files.get(rel) ?? '');

/** 화면 경로 → 그 page.tsx(src 기준). 라우트 그룹 `(admin)` 은 경로에 안 나온다. */
export function pageFileOf(screen: string): string | null {
  for (const root of ['app', 'app/(admin)']) {
    const rel = `${root}${screen}/page.tsx`;
    if (existsSync(join(SRC, rel))) return rel;
  }
  return null;
}
