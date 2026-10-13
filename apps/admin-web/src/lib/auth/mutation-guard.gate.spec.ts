import { join } from 'node:path';
import { PERMISSION_CATALOG } from '@permission-catalog';
import { analyzeAdminWeb } from './mutation-guard-graph';
import { MASTER_ONLY_MUTATIONS, UNGUARDED_MUTATIONS } from './mutation-guard.exceptions';
import { requirementMet } from './mutation-permission';
import { resolveScreenAccess } from './screen-access';

/**
 * 관리자 화면의 쓰기 동작 게이트.
 * ① 뮤테이션 훅·컴포넌트 안 뮤테이션은 권한을 선언한다 ② admin 은 master 전용 말고 전부 실행할 수 있다
 * ③ 뮤테이션을 부르는 화면 파일은 그 파일이나 그 파일을 import 하는 상위 파일에 그 권한 판정(또는 화면 진입 권한)이 있다.
 * ③은 «파일에 판정이 하나라도 있는가»까지만 본다 — 버튼 하나하나는 화면 실측이 본다.
 */
const SRC = join(__dirname, '../..');
const screenKeys = (screen: string): readonly string[] => {
  const access = resolveScreenAccess(screen);
  return access && access.kind === 'permission' ? access.anyOf : [];
};
const analysis = analyzeAdminWeb(SRC, screenKeys);
const hooks = [...analysis.hooks.values()];
const adminHeld: ReadonlySet<string> = new Set(
  PERMISSION_CATALOG.filter((p) => p.grantOnFirstRegistration.some((role) => role === 'admin')).map((p) => p.key),
);

describe('admin-web write actions', () => {
  it('finds the mutation hooks and the screens that run them', () => {
    expect(hooks.length).toBeGreaterThan(350);
    expect(analysis.consumers.size).toBeGreaterThan(150);
    expect(analysis.consumers.get('features/mall/notices/components/table/index.tsx')?.map((h) => h.key)).toContain(
      'lib/services/products/mutations.ts#useDeleteNotice',
    );
  });

  it('declares the permission of every mutation hook', () => {
    expect(hooks.filter((h) => h.requirement === null).map((h) => h.key)).toEqual([]);
  });

  it('declares the permission of every mutation made inside a component', () => {
    expect(analysis.inline.filter((m) => m.requirement === null).map((m) => `${m.file}:${m.line}`)).toEqual([]);
  });

  it('lets admin run every declared mutation except the master-only ones', () => {
    const blocked = hooks.filter((h) => h.requirement !== null && !requirementMet(adminHeld, h.requirement)).map((h) => h.key);
    expect(blocked.filter((key) => !MASTER_ONLY_MUTATIONS.includes(key))).toEqual([]);
    expect(MASTER_ONLY_MUTATIONS.filter((key) => !blocked.includes(key))).toEqual([]);
  });

  it('checks the permission of every mutation a screen runs', () => {
    const allowed = new Set(UNGUARDED_MUTATIONS.map((e) => e.entry));
    expect(analysis.uncovered.filter((u) => !allowed.has(u))).toEqual([]);
    expect(UNGUARDED_MUTATIONS.filter((e) => !analysis.uncovered.includes(e.entry)).map((e) => e.entry)).toEqual([]);
    expect(UNGUARDED_MUTATIONS.filter((e) => e.reason.trim() === '').map((e) => e.entry)).toEqual([]);
  });
});
