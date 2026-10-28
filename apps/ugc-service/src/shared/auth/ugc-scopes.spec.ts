import { UGC_ROLE_MAPPINGS, UGC_SCOPE, UGC_SCOPES } from './ugc-scopes';

describe('ugc 스코프 선언', () => {
  const declared = new Set(UGC_SCOPES.map((s) => s.key));

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
