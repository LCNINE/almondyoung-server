import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { UGC_ROLE_MAPPINGS, UGC_SCOPE, UGC_SCOPES } from './ugc-scopes';

const SRC = join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('ugc 스코프 선언', () => {
  const declared = new Set(UGC_SCOPES.map((s) => s.key));

  // 선언되지 않은 키를 @RequireScopes 에 쓰면 부팅 때 등록도 매핑도 되지 않아 master 외엔 아무도 못 연다.
  it('컨트롤러가 요구하는 스코프는 모두 선언돼 있다', () => {
    const required = new Set(
      sourceFiles(SRC).flatMap((file) =>
        [...readFileSync(file, 'utf8').matchAll(/RequireScopes\(\s*'([^']+)'/g)].map((m) => m[1]),
      ),
    );
    expect(required.size).toBeGreaterThan(0);
    expect([...required].filter((key) => !declared.has(key))).toEqual([]);
  });

  it('매핑은 선언된 스코프만 쓴다', () => {
    const mapped = UGC_ROLE_MAPPINGS.flatMap((m) => m.scopeKeys);
    expect(mapped.filter((key) => !declared.has(key))).toEqual([]);
  });

  // core 에서 샵 매매를 관리하던 admin 이 ugc 로 옮긴 뒤에도 관리할 수 있어야 한다(2026-09-24 결정).
  it('admin 은 조회·관리 스코프를 모두 가진다', () => {
    const admin = UGC_ROLE_MAPPINGS.find((m) => m.roleName === 'admin');
    expect(admin?.scopeKeys).toEqual(expect.arrayContaining([UGC_SCOPE.READ, UGC_SCOPE.MODIFY]));
  });
});
