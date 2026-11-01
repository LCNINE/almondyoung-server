import { TENANT_SLUG_PATTERN, TenantList } from '../../../libs/tenancy/src/tenant-list';
import { CoreTenantTarget, ServiceConfig } from './types';

/**
 * core DB 는 테넌트마다 따로다. DB 도구(bootstrap·migrate·seed:ref·preflight)는 정적 레지스트리의 core 한 줄을
 * 테넌트 목록의 테넌트마다 펼친다. 이름 규칙(`core_*`)으로 테넌트를 «찾지» 않는다 — 남은 DB 하나가 조용히
 * 테넌트가 되지 않게. `core_<slug>` 는 목록에 아직 없는 준비 중 테넌트를 `--tenant` 로 «지목»할 때만 쓴다.
 *
 * 테넌트 1 전용 시드(창고·자사몰)는 정적 레지스트리의 core DB(테넌트 이전부터 있던 그 DB)를 coreDb 로 가진
 * 테넌트에만 간다 — 테넌트 1 의 id 를 코드에 두지 않는다.
 */
export function resolveCoreTargets(
  list: TenantList,
  options: { legacyDatabase: string; tenantSlug?: string },
): CoreTenantTarget[] {
  const toTarget = (e: TenantList['entries'][number]): CoreTenantTarget => ({
    tenantId: e.id,
    slug: e.slug,
    database: e.coreDb,
    tenantOneData: e.coreDb === options.legacyDatabase,
  });

  const slug = options.tenantSlug;
  if (slug === undefined) return list.entries.map(toTarget);

  if (!TENANT_SLUG_PATTERN.test(slug)) {
    throw new Error(`--tenant 의 slug 형식이 틀렸다 — 소문자 영문으로 시작하는 소문자 영문·숫자 32자 이하: ${slug}`);
  }
  const listed = list.entries.find((e) => e.slug === slug);
  if (listed) return [toTarget(listed)];

  const database = `core_${slug}`;
  const owner = list.entries.find((e) => e.coreDb === database);
  if (owner) throw new Error(`${database} 는 이미 테넌트 ${owner.id} 의 core DB 다 — 그 테넌트의 slug 로 지목한다`);

  return [{ tenantId: null, slug, database, tenantOneData: database === options.legacyDatabase }];
}

/**
 * 레지스트리의 core 줄을 테넌트마다 하나로 바꾼다. `onlyCore` 면 core 만 남긴다 — `--tenant` 는 그 DB 하나만
 * 다루고, 테넌트가 함께 쓰는 서비스 DB 는 평소 실행이 맡는다.
 */
export function expandCoreEntries(
  registry: readonly ServiceConfig[],
  targets: readonly CoreTenantTarget[],
  options: { onlyCore: boolean },
): ServiceConfig[] {
  return registry.flatMap((svc) => {
    if (svc.name === 'core') return targets.map((tenant) => ({ ...svc, database: tenant.database, tenant }));
    return options.onlyCore ? [] : [svc];
  });
}

/** 출력용 이름 — core 는 어느 테넌트인지 붙인다(DB 이름 대신 id·slug) */
export function serviceLabel(svc: ServiceConfig): string {
  if (!svc.tenant) return svc.name;
  return svc.tenant.tenantId === null
    ? `${svc.name}(준비 ${svc.tenant.slug})`
    : `${svc.name}(테넌트 ${svc.tenant.tenantId})`;
}
