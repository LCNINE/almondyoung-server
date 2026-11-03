/**
 * 계정 테넌트 채우기(`20261103013734_backfill-account-tenant.sql`)가 «테넌트 1 이 아닌 테넌트»와 이어진 계정을 어떻게 나눌지 미리 본다.
 * 읽기만 한다. 마이그 «전» 스키마(users.tenant_id 가 아직 없다)에서 돌아야 하므로 그 칸을 읽지 않는다 — 소속·부여·운영자 성질만 본다.
 *
 * 규칙은 마이그의 1·3·4번 문장과 같다(통합 스펙 `account-tenant-backfill.integration.spec.ts` 가 둘이 같은 계정을 고르는지 본다).
 * «이어진 테넌트»가 무엇인지(테넌트 1 소속은 왜 치지 않는지)는 마이그 파일 머리 주석.
 * - 이어진 테넌트가 테넌트 1 이 아닌 하나뿐 → 그 테넌트로 옮긴다(`move`). 거두는 테넌트 1 소속은 `loses` 에 보인다 — 시드가 만든
 *   가짜 소속이 대부분이지만, 역할을 모두 잃은 테넌트 1 직원의 진짜 소속일 수도 있어 사람이 본다.
 * - 그 밖에 테넌트 1 이 아닌 테넌트와 이어진 계정 → 테넌트 1 에 남고 다른 테넌트의 부여·소속을 잃는다(`keep-in-tenant-one`).
 *   이 갈래가 0 이 아니면 사람이 명단을 확인한 뒤 마이그를 돌린다.
 */
export const ACCOUNT_TENANT_PREVIEW_SQL = `
WITH ties AS (
  SELECT "user_id", coalesce("tenant_id", '1') AS "tenant_id" FROM "user_roles"
  UNION
  SELECT "user_id", "tenant_id" FROM "tenant_memberships" WHERE "tenant_id" <> '1'
  UNION
  SELECT "user_id", '1' FROM "user_consents"
  UNION
  SELECT "user_id", '1' FROM "user_identities"
  UNION
  SELECT "id", '1' FROM "users" WHERE "is_platform_operator"
),

per_user AS (
  SELECT "user_id", array_agg(DISTINCT "tenant_id" ORDER BY "tenant_id") AS "tenants"
  FROM ties
  GROUP BY "user_id"
),
decided AS (
  SELECT
    u."id" AS "user_id",
    u."login_id",
    u."is_platform_operator" AS "operator",
    p."tenants",
    CASE WHEN cardinality(p."tenants") = 1 THEN p."tenants"[1] ELSE '1' END AS "account_tenant"
  FROM per_user p
  JOIN "users" u ON u."id" = p."user_id"
  WHERE EXISTS (SELECT 1 FROM unnest(p."tenants") t WHERE t <> '1')
)
SELECT
  "user_id",
  "login_id",
  "operator",
  "tenants",
  "account_tenant",
  ARRAY(
    SELECT t FROM unnest("tenants") t WHERE t <> "account_tenant"
    UNION
    SELECT m."tenant_id" FROM "tenant_memberships" m WHERE m."user_id" = decided."user_id" AND m."tenant_id" <> "account_tenant"
    ORDER BY 1
  ) AS "loses",
  CASE WHEN "account_tenant" = '1' THEN 'keep-in-tenant-one' ELSE 'move' END AS "outcome"
FROM decided
ORDER BY "outcome", "login_id"
`;

export interface AccountTenantPreviewRow {
  readonly user_id: string;
  readonly login_id: string;
  readonly operator: boolean;
  /** 이어진 테넌트 전부(부여·테넌트 1 이 아닌 소속·테넌트 1 쇼핑몰 흔적·운영자). */
  readonly tenants: string[];
  /** 채우기 뒤 계정의 테넌트. */
  readonly account_tenant: string;
  /** 채우기가 부여·소속을 거두는 테넌트(가짜 테넌트 1 소속 포함). */
  readonly loses: string[];
  readonly outcome: 'move' | 'keep-in-tenant-one';
}

export interface AccountTenantPreview {
  readonly moving: readonly AccountTenantPreviewRow[];
  readonly keptInTenantOne: readonly AccountTenantPreviewRow[];
}

export function splitPreview(rows: readonly AccountTenantPreviewRow[]): AccountTenantPreview {
  return {
    moving: rows.filter((r) => r.outcome === 'move'),
    keptInTenantOne: rows.filter((r) => r.outcome === 'keep-in-tenant-one'),
  };
}

/** 사람이 읽는 보고와 끝 코드. 무언가를 잃는 계정(테넌트 1 에 남든 옮겨 가든)이 있으면 1 — 명단을 확인하기 전에는 마이그를 돌리지 않는다. */
export function renderPreview(preview: AccountTenantPreview): { lines: string[]; exitCode: 0 | 1 } {
  const row = (r: AccountTenantPreviewRow) =>
    `  ${r.login_id}  (${r.user_id})  이어진 테넌트 [${r.tenants.join(', ')}]${r.operator ? '  운영자' : ''}` +
    `  → 테넌트 ${r.account_tenant}` +
    (r.loses.length > 0 ? `, 거둠 [${r.loses.join(', ')}]` : '');
  const lines = [
    `다른 테넌트 계정이 되는 계정: ${preview.moving.length}`,
    ...preview.moving.map(row),
    '',
    `테넌트 1 에 남고 다른 테넌트의 부여·소속을 잃는 계정: ${preview.keptInTenantOne.length}`,
    ...preview.keptInTenantOne.map(row),
  ];
  const losing = [...preview.moving, ...preview.keptInTenantOne].filter((r) => r.loses.length > 0);
  if (losing.length === 0) {
    lines.push('', '✓ 잃는 계정 없음 — 채우기 마이그를 돌려도 된다.');
    return { lines, exitCode: 0 };
  }
  lines.push(
    '',
    `✗ 위 ${losing.length}개 계정은 채우기 마이그가 «거둠» 테넌트의 부여·소속을 거둔다. 명단을 확인받은 뒤 마이그를 돌린다.`,
    '  옮겨 가는 계정이 거두는 테넌트 1 소속은 대개 시드가 만든 가짜다(역할 없는 소속). 테넌트 1 에 남는 계정의 다른 테넌트 계정은',
    '  마이그 뒤 그 테넌트의 master(또는 첫 master 경로)가 새로 만든다.',
  );
  return { lines, exitCode: 1 };
}
