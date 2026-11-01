import { expectOk } from './http';

/**
 * 테넌트의 테넌트 도메인 전부(호스트:포트) — user-service 가 들고 있는 값(`tenant_domains`)을 auth-web 과 같은 내부 조회로 읽는다.
 * 도메인을 실측 설정에 따로 적지 않는다(갈린다). 그 주소가 다른 테넌트의 것이면 던진다 — 점검 대상이 틀렸다.
 */
export async function tenantDomainsOf(
  userService: string,
  internalSecret: string,
  host: string,
  expectedTenantId: string,
): Promise<string[]> {
  const body = (await expectOk('GET', `${userService}/tenant-brand/site?host=${encodeURIComponent(host)}`, {
    headers: { 'x-internal-secret': internalSecret },
  })) as { data?: { tenantId?: string; hosts?: string[] } };
  // user-service 는 응답을 `{ success, data }` 로 싼다
  const site = body.data;
  if (!site?.tenantId || !Array.isArray(site.hosts))
    throw new Error(`/tenant-brand/site 응답 모양이 다르다: ${JSON.stringify(body).slice(0, 160)}`);
  if (site.tenantId !== expectedTenantId)
    throw new Error(`${host} 는 테넌트 ${site.tenantId} 의 주소다 — 테넌트 ${expectedTenantId} 가 아니다`);
  return site.hosts;
}
