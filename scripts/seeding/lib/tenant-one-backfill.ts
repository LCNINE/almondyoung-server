import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '../../../apps/user-service/database/drizzle');

/**
 * user-service 테넌트 1 백필 마이그들. 멱등이라 시드가 관리자 계정과 OAuth 클라이언트를 넣은 «뒤에» 다시 돌린다 —
 * 새 DB 에선 마이그 시점에 직원도 OAuth 클라이언트도 없어 백필이 아무것도 못 채운다.
 * 시드가 같은 일을 따로 적지 않고 마이그 파일을 정본으로 쓴다. 순서가 뜻이 있다 — 클라이언트 고정 테넌트는
 * 테넌트 도메인이 채워진 뒤에 정한다.
 */
export const TENANT_ONE_BACKFILL_MIGRATIONS = [
  // 테넌트 1 행·테넌트 도메인·소속·운영자·부여 테넌트
  join(MIGRATIONS_DIR, '20261030055256_backfill-tenant-one-memberships-operators.sql'),
  // 리디렉트 host 가 테넌트 도메인이 아닌 클라이언트 → 고정 테넌트 1
  join(MIGRATIONS_DIR, '20261030102301_backfill-oauth-client-fixed-tenant.sql'),
];

/** 계정 테넌트 채우기(ADR-0056 expand). 통합 스펙이 마이그 파일을 정본으로 다시 돌린다. */
export const ACCOUNT_TENANT_BACKFILL_MIGRATION = join(MIGRATIONS_DIR, '20261103013734_backfill-account-tenant.sql');

function statementsOf(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/**
 * 첫 마이그의 소속 문장은 테넌트를 가리지 않고 «살아 있는 직원 부여 → 테넌트 1 소속»을 만든다 — 다른 테넌트가 생긴 뒤에 다시 돌리면
 * 그 테넌트 직원에게 가짜 테넌트 1 소속이 붙는다. 그래서 다시 돌릴 때는 계정 테넌트 채우기의 «계정의 테넌트가 아닌 소속 거두기»를
 * 뒤에 붙인다(채우기 전체는 아니다 — 부여를 거두는 문장까지 시드가 다시 돌리면 안 된다).
 */
export function tenantOneBackfillStatements(): string[] {
  const stripForeignMemberships = statementsOf(ACCOUNT_TENANT_BACKFILL_MIGRATION).filter((s) =>
    s.includes('DELETE FROM "tenant_memberships"'),
  );
  if (stripForeignMemberships.length !== 1) {
    throw new Error(`${ACCOUNT_TENANT_BACKFILL_MIGRATION} 에서 소속 거두기 문장을 하나 찾아야 한다`);
  }
  return [...TENANT_ONE_BACKFILL_MIGRATIONS.flatMap(statementsOf), ...stripForeignMemberships];
}

export function accountTenantBackfillStatements(): string[] {
  return statementsOf(ACCOUNT_TENANT_BACKFILL_MIGRATION);
}
