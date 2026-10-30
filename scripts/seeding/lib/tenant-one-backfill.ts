import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * user-service 테넌트 1 백필 마이그(소속·운영자·도메인·부여 테넌트). 멱등이라 시드가 관리자 계정과 OAuth 클라이언트를
 * 넣은 «뒤에» 다시 돌린다 — 새 DB 에선 마이그 시점에 직원도 admin-web 클라이언트도 없어 백필이 아무것도 못 채운다.
 * 시드가 같은 일을 따로 적지 않고 마이그 파일 하나를 정본으로 쓴다.
 */
export const TENANT_ONE_BACKFILL_MIGRATION = join(
  __dirname,
  '../../../apps/user-service/database/drizzle/20261030055256_backfill-tenant-one-memberships-operators.sql',
);

export function tenantOneBackfillStatements(): string[] {
  return readFileSync(TENANT_ONE_BACKFILL_MIGRATION, 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}
