import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * 인자 없이 부른 쿼리키 팩토리가 `['foo', undefined]` 를 만들면 그 키로는 아무것도 무효화되지 않는다 —
 * TanStack 의 partialMatchKey 는 접두사가 아니라 위치별로 비교하고, 꼬리의 `undefined` 도 비교 대상이다.
 * 에러 없이 «저장했는데 목록이 그대로»가 된다(데모 관리자 사용성 테스트 F03, 발주 #739).
 * 그래서 코드 어디서든 `xxxQueryKeys.foo()` 처럼 인자 없이 부르는 팩토리는 `undefined` 없는 키를 만들어야 한다.
 * 무효화에 넓게 쓰려면 팩토리 옆에 루트 키(`fooRoot: ['foo'] as const`)를 둔다.
 */
const SRC = join(__dirname, '..', '..');

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) return [];
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [p] : [];
  });

const files = walk(SRC);
const keyModules = files.filter((f) => /\/query-keys\.ts$/.test(f));

/** 인자 없이 부르면 `undefined` 를 품는 팩토리 — `이름.속성` */
const dead = new Set<string>();
for (const file of keyModules) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod: Record<string, unknown> = require(file);
  for (const [name, value] of Object.entries(mod)) {
    if (!/QueryKeys$/.test(name) || typeof value !== 'object' || value === null) continue;
    for (const [prop, factory] of Object.entries(value)) {
      if (typeof factory !== 'function') continue;
      let key: unknown;
      try {
        key = (factory as () => unknown)();
      } catch {
        continue;
      }
      if (Array.isArray(key) && key.some((part) => part === undefined)) dead.add(`${name}.${prop}`);
    }
  }
}

describe('쿼리키 팩토리를 인자 없이 부르는 곳', () => {
  it('팩토리를 실제로 읽었다 — 빈 결과는 검사가 깨졌다는 뜻이다', () => {
    expect(keyModules.length).toBeGreaterThan(10);
    expect(dead.size).toBeGreaterThan(0);
  });

  it('인자 없이 부른 팩토리가 undefined 를 품은 키를 만들지 않는다(무효화가 조용히 무효가 된다)', () => {
    const found = files.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/\b([A-Za-z]+QueryKeys)\.([A-Za-z]+)\(\s*\)/g)]
        .filter((m) => dead.has(`${m[1]}.${m[2]}`))
        .map((m) => `${relative(SRC, file)}: ${m[1]}.${m[2]}()`),
    );
    expect([...new Set(found)].sort()).toEqual([]);
  });
});
