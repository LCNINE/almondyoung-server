import { execFileSync } from 'child_process';
import { parseTenantList, TenantList } from '../../../libs/tenancy/src/tenant-list';
import { expandCoreEntries, resolveCoreTargets } from './core-tenants';
import { getServiceRegistry } from './service-registry';
import { ServiceConfig } from './types';

const REGION = process.env.AWS_REGION ?? 'ap-northeast-2';

/**
 * 그 stage 의 테넌트 목록. SoT 는 lcnine-auth 의 `TenantList` 시크릿이고 services 앱처럼 SSM 사본을 읽는다 —
 * services 배포의 sst shell 에는 그 시크릿이 없다. env(`TENANT_LIST`)는 일부러 보지 않는다: 로컬 목록이
 * 셸에 남아 있으면 라이브 실행이 그 목록대로 테넌트 DB 를 빠뜨린다.
 */
export function readStageTenantList(stage: string): TenantList {
  const name = `/lcnine-auth/${stage}/tenant-list`;
  let raw: string;
  try {
    raw = execFileSync(
      'aws',
      ['ssm', 'get-parameter', '--name', name, '--with-decryption', '--query', 'Parameter.Value', '--output', 'text'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, AWS_REGION: REGION } },
    );
  } catch {
    throw new Error(
      `테넌트 목록(SSM ${name})을 읽지 못했다 — 기본 목록은 없다. AWS 로그인(aws login --profile login)을 확인하고, ` +
        `값이 없으면 lcnine-auth 에 sst secret set TenantList 뒤 auth 를 배포한다`,
    );
  }
  return parseTenantList(raw.trim());
}

/**
 * DB 도구가 도는 레지스트리. core 가 있는 배포면 core 한 줄을 테넌트 목록의 테넌트마다 펼친다.
 * `tenant`(`--tenant <slug>`)를 주면 그 테넌트의 core DB 하나만 남긴다 — 목록에 아직 없는 준비 중 테넌트는
 * 이 길로만 닿는다.
 */
export function resolveRegistry(options: { deployment?: string; tenant?: string }): ServiceConfig[] {
  const registry = getServiceRegistry(options.deployment);
  const core = registry.find((s) => s.name === 'core');
  if (!core) {
    if (options.tenant !== undefined) {
      throw new Error(`--tenant 는 core 가 있는 배포에서만 쓴다 (deployment: ${options.deployment ?? 'root'})`);
    }
    return registry;
  }
  const stage = process.env.SST_STAGE;
  if (!stage) throw new Error('SST_STAGE 가 없다 — sst shell 안에서 돌아야 그 stage 의 테넌트 목록을 읽는다');

  const targets = resolveCoreTargets(readStageTenantList(stage), {
    legacyDatabase: core.database,
    tenantSlug: options.tenant,
  });
  return expandCoreEntries(registry, targets, { onlyCore: options.tenant !== undefined });
}
