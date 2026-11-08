import { tenantOneBackfillStatements } from './tenant-one-backfill';

/**
 * 시드는 계정·클라이언트를 넣은 뒤 테넌트 1 백필을 다시 돌린다. 백필 마이그는 expand 때의 모양이라, 테넌트 칸을 조인 뒤(impl-b 28)엔
 * 그대로 다시 돌리면 안 되는 문장이 있다 — 기본 테넌트를 되살리는 기본값, 앱 없이 넣는 테넌트 도메인.
 */
describe('tenantOneBackfillStatements — 시드가 다시 돌리는 테넌트 1 백필', () => {
  const statements = tenantOneBackfillStatements();

  it('칸 기본값을 다시 걸지 않는다 — 기본 테넌트는 없다', () => {
    expect(statements.filter((s) => /\bSET\s+DEFAULT\b/i.test(s))).toEqual([]);
  });

  it('테넌트 도메인은 admin-web 앱으로 넣는다 — app 은 NOT NULL 이다', () => {
    const inserts = statements.filter((s) => /INSERT INTO "tenant_domains"/.test(s));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatch(/\("host", "tenant_id", "app"\)/);
    expect(inserts[0]).toMatch(/'1', 'admin-web'/);
  });

  // 일회성 백필이다. 지금 다시 돌리면 운영자 성질 변경처럼 일부러 테넌트 없이 적은 이력이 테넌트 1 로 바뀐다(부여·접속기록은 NOT NULL).
  it('부여·이력·접속기록의 빈 테넌트를 테넌트 1 로 채우지 않는다', () => {
    expect(statements.filter((s) => /UPDATE "(user_roles|iam_audit_logs|pii_access_logs)" SET "tenant_id"/.test(s))).toEqual([]);
  });

  it('소속 표는 없다', () => {
    expect(statements.filter((s) => s.includes('"tenant_memberships"'))).toEqual([]);
  });
});
