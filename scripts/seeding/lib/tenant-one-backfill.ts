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

export function tenantOneBackfillStatements(): string[] {
  return TENANT_ONE_BACKFILL_MIGRATIONS.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0),
  );
}
