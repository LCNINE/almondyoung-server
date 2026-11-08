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

/** 첫 마이그의 테넌트 도메인 INSERT 는 앱 칸 전의 모양이다 — 그 주소는 admin-web OAuth 클라이언트의 리디렉트 host 라 admin-web 주소다. */
const DOMAIN_INSERT_BEFORE_APP = {
  columns: ['INSERT INTO "tenant_domains" ("host", "tenant_id")', 'INSERT INTO "tenant_domains" ("host", "tenant_id", "app")'],
  values: ["'1'\nFROM \"oauth_clients\"", "'1', 'admin-web'\nFROM \"oauth_clients\""],
} as const;

function withDomainApp(statement: string): string {
  if (!statement.includes(DOMAIN_INSERT_BEFORE_APP.columns[0])) return statement;
  const [columnsFrom, columnsTo] = DOMAIN_INSERT_BEFORE_APP.columns;
  const [valuesFrom, valuesTo] = DOMAIN_INSERT_BEFORE_APP.values;
  if (!statement.includes(valuesFrom)) throw new Error('테넌트 1 백필: 테넌트 도메인 INSERT 의 모양이 예상과 다르다');
  return statement.replace(columnsFrom, columnsTo).replace(valuesFrom, valuesTo);
}

/**
 * 마이그 문장을 시드가 다시 돌려도 되는 모양으로 고른다(ADR-0056·impl-b 28 의 contract 뒤):
 * - 소속 문장은 걷는다 — 소속 표는 계정이 한 테넌트의 것이 되며 없어졌다.
 * - 칸 기본값을 거는 ALTER 는 걷는다 — contract 가 걷은 기본 테넌트('1')를 되살린다.
 * - 부여·이력·접속기록의 빈 테넌트를 '1' 로 채우는 일회성 백필은 걷는다 — 부여·접속기록은 NOT NULL 이라 할 일이 없고, 이력은
 *   운영자 성질 변경처럼 일부러 테넌트 없이 적은 행을 테넌트 1 로 바꿔 버린다.
 * - 테넌트 도메인 INSERT 에 앱(admin-web)을 싣는다 — `tenant_domains.app` 은 NOT NULL 이다.
 * 남은 문장(테넌트 1 행·도메인·운영자·부여 테넌트·클라이언트 고정 테넌트)은 그대로 멱등이다.
 */
export function tenantOneBackfillStatements(): string[] {
  return TENANT_ONE_BACKFILL_MIGRATIONS.flatMap(statementsOf)
    .filter((s) => !s.includes('"tenant_memberships"'))
    .filter((s) => !/\bSET\s+DEFAULT\b/i.test(s))
    .filter((s) => !/^UPDATE "(user_roles|iam_audit_logs|pii_access_logs)" SET "tenant_id" = '1' WHERE "tenant_id" IS NULL;?$/m.test(s))
    .map(withDomainApp);
}
