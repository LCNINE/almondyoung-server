import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '../../../apps/user-service/database/drizzle');

/**
 * 시드가 만드는 계정(관리자·데모·샘플 직원)의 테넌트 — 테넌트 1 백필 마이그가 만드는 테넌트 1 행이다. 계정 테넌트에는 DB 기본값이 없어
 * (기본 테넌트 없음, ADR-0056) 계정을 넣는 시드는 이 값을 적는다. 테넌트 1 이 아닌 테넌트의 계정은 시드가 아니라 테넌트 만들기 스크립트가 만든다.
 */
export const TENANT_ONE_ID = '1';

/**
 * user-service 테넌트 1 백필 마이그들. 멱등이라 시드가 관리자 계정과 OAuth 클라이언트를 넣은 «뒤에» 다시 돌린다 —
 * 새 DB 에선 마이그 시점에 직원도 OAuth 클라이언트도 없어 백필이 아무것도 못 채운다.
 * 시드가 같은 일을 따로 적지 않고 마이그 파일을 정본으로 쓴다. 순서가 뜻이 있다 — 클라이언트 고정 테넌트는
 * 테넌트 도메인이 채워진 뒤에 정한다.
 */
export const TENANT_ONE_BACKFILL_MIGRATIONS = [
  // 테넌트 1 행·테넌트 도메인·운영자·부여 테넌트 (소속 문장은 아래에서 걷는다)
  join(MIGRATIONS_DIR, '20261030055256_backfill-tenant-one-memberships-operators.sql'),
  // 리디렉트 host 가 테넌트 도메인이 아닌 클라이언트 → 고정 테넌트 1
  join(MIGRATIONS_DIR, '20261030102301_backfill-oauth-client-fixed-tenant.sql'),
];

function statementsOf(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/**
 * 첫 마이그의 소속 문장은 걷는다 — 소속 표는 계정이 한 테넌트의 것이 되며 없어졌다(ADR-0056 contract). 남은 문장(테넌트 1 행·도메인·
 * 운영자·부여 테넌트·클라이언트 고정 테넌트)은 그대로 멱등이다.
 */
export function tenantOneBackfillStatements(): string[] {
  return TENANT_ONE_BACKFILL_MIGRATIONS.flatMap(statementsOf).filter((s) => !s.includes('"tenant_memberships"'));
}
