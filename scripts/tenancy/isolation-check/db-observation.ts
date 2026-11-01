import type { Sql } from 'postgres';
import type { CronObservation } from './target';

/**
 * 블랙박스로 못 재는 두 관측 — 로컬 대상과 라이브 수집기(sst shell 안)가 같은 SQL 을 쓴다.
 * 읽기만 한다.
 */

const DIGITAL_ASSET_CONTEXT = 'digital-asset-file';
/** 테넌트 1 에서 최근 돈 크론을 고르는 창. 테넌트 2 는 조금 넓게 본다(같은 주기라도 선점 시각이 몇 초 갈린다). */
const TENANT_ONE_WINDOW_MINUTES = 10;
const TENANT_TWO_WINDOW_MINUTES = 15;

async function recentCronNames(sql: Sql, minutes: number): Promise<string[]> {
  const rows = await sql<{ name: string }[]>`
    SELECT DISTINCT name FROM cron_runs WHERE claimed_at > now() - make_interval(mins => ${minutes})`;
  return rows.map((r) => r.name);
}

/**
 * «주기당 1행»은 `cron_runs` 의 PK(name, period_at)가 이미 보장한다 — 두 번 선점은 INSERT 가 막는다. 실측이 볼 것은
 * «테넌트마다 따로 선점되는가»다: 테넌트 1 에서 최근 돈 크론이 테넌트 2 DB 에도 선점 행을 남겼어야 한다.
 */
export async function observeCronRuns(tenantOne: Sql, tenantTwo: Sql): Promise<CronObservation> {
  const one = await recentCronNames(tenantOne, TENANT_ONE_WINDOW_MINUTES);
  const two = new Set(await recentCronNames(tenantTwo, TENANT_TWO_WINDOW_MINUTES));
  return {
    tenantOneRecent: one.length,
    missingInTenantTwo: one.filter((name) => !two.has(name)).sort(),
    windowMinutes: TENANT_ONE_WINDOW_MINUTES,
  };
}

export async function findDigitalAssetFile(fileService: Sql, tenantId: string): Promise<string | null> {
  const rows = await fileService<{ id: string }[]>`
    SELECT id FROM uploads WHERE context_id = ${DIGITAL_ASSET_CONTEXT} AND tenant_id = ${tenantId}
      AND deleted_at IS NULL LIMIT 1`;
  return rows[0]?.id ?? null;
}

export { DIGITAL_ASSET_CONTEXT };
