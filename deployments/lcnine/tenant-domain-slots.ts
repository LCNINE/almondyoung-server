// 테넌트 도메인 칸 — SST 전역이 없는 순수 모듈이라 jest 가 직접 import 한다.
// 실제 CloudFront 배포·DNS·무효화 선언은 `tenant-domain-distribution.ts`.

/** 칸을 받는 사이트. 사이트마다 SST 앱이 달라 Secret 도 그 앱에 따로 넣는다(AdminWeb=services, AuthWeb=auth). */
export type TenantSlotSite = 'AdminWeb' | 'AuthWeb';

type SlotTable = Readonly<Record<string, readonly number[]>>;

/**
 * stage 마다 테넌트 도메인 칸 번호. 번호가 곧 리소스 논리 이름이다(`AdminWebTenantSlot1` …).
 *
 * 칸의 «개수»는 여기 코드에만 둔다 — env·Secret 값으로 정하면 그 값 없이 배포한 머신이나 지워진 Secret 하나가
 * 테넌트 배포를 조용히 지운다. 칸을 빼는 것은 이 표에서 번호를 지우는 커밋 하나다.
 *
 * 칸을 켜면 그 stage 의 배포는 칸의 Secret 셋이 다 들어가야 시작한다(`missingTenantSlotSecrets`).
 * 그래서 인증서가 아직 없는 칸은 켜지 않는다 — 켜는 것은 테넌트 만들기(라이브)의 사람 손 단계다.
 * `run()` 을 도는 다른 명령(`sst diff`·`sst remove`·`sst shell`)도 같이 멈춘다.
 */
export const TENANT_DOMAIN_SLOTS: SlotTable = { live: [1] };

export function tenantDomainSlotsFor(stage: string, table: SlotTable = TENANT_DOMAIN_SLOTS): readonly number[] {
  return table[stage] ?? [];
}

/** 칸 하나의 Secret 이름. 값(도메인·us-east-1 인증서 ARN·Route53 존 ID)은 레포에 적지 않는다. */
export function tenantSlotSecretNames(site: TenantSlotSite, slot: number) {
  const prefix = `${site}TenantSlot${slot}`;
  return {
    domain: `${prefix}Domain`,
    certArn: `${prefix}CertArn`,
    zoneId: `${prefix}ZoneId`,
  };
}

/**
 * 켜진 칸의 Secret 중 비어 있는 것. `sst.Secret` 은 값이 없으면 apply 안에서야 던지는데, 그때는 앞서 등록된
 * 리소스(Core 등)가 이미 바뀌기 시작한 뒤라 «반쯤 된 배포»가 남는다. 그래서 `run()` 맨 앞에서 이것으로 먼저 멈춘다.
 *
 * SST CLI 는 stage 의 Secret 을 `SST_SECRET_<이름>` env 로 프로그램에 넣는다 — `sst.Secret` 자신도 같은 곳을 읽는다
 * (`.sst/platform/src/components/secret.ts`).
 */
export function missingTenantSlotSecrets(
  stage: string,
  site: TenantSlotSite,
  env: Readonly<Record<string, string | undefined>>,
  table: SlotTable = TENANT_DOMAIN_SLOTS,
): string[] {
  return tenantDomainSlotsFor(stage, table)
    .flatMap((slot) => Object.values(tenantSlotSecretNames(site, slot)))
    .filter((name) => !env[`SST_SECRET_${name}`]?.trim());
}

/** `sst.config.ts` 의 `run()` 맨 앞에서 부른다 — 어떤 리소스도 등록되기 전에 멈춰야 반쯤 된 배포가 안 남는다. */
export function assertTenantSlotSecretsSet(
  stage: string,
  site: TenantSlotSite,
  env: Readonly<Record<string, string | undefined>>,
  table: SlotTable = TENANT_DOMAIN_SLOTS,
): void {
  const missing = missingTenantSlotSecrets(stage, site, env, table);
  if (missing.length === 0) return;
  throw new Error(
    `${site} 테넌트 도메인 칸이 켜져 있는데 Secret 이 비었다. 배포를 시작하지 않는다:\n` +
      missing.map((name) => `  npx sst secret set ${name} <값> --stage ${stage}`).join('\n'),
  );
}
