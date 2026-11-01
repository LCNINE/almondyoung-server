/**
 * 라이브 만들기의 시작 조건. 하나라도 틀리면 아무 단계도 돌리지 않는다 — 러너 밖에서 본다
 * (러너 안 단계로 두면 이미 반쯤 만든 테넌트를 다시 돌릴 때 «연결 여유 부족» 한 번이 되돌리기를 부른다).
 */

/** core 라우팅 풀 하나의 크기 — `libs/db/src/db.service.ts` 의 `ROUTED_POOL_MAX`(spec 이 대조한다). 폴러·크론도 이 풀을 쓴다 */
export const CORE_POOL_PER_TENANT = 10;
/** core 롤링 배포 중엔 옛 태스크와 새 태스크가 함께 떠 풀이 두 벌이다(Core scaling 1 — 기본값) */
const CORE_TASKS_DURING_DEPLOY = 2;
/** 이 스크립트·마이그·시드가 그 사이에 여는 연결 */
const SCRIPT_CONNECTIONS = 5;
/** 테넌트 한 벌 = 풀 × 배포 중 태스크 + 스크립트. «넉넉»은 그 두 배다 — 오늘 사용량은 풀이 첫 쿼리에 열려 실제보다 낮게 보인다 */
export const REQUIRED_FREE_CONNECTIONS = 2 * (CORE_POOL_PER_TENANT * CORE_TASKS_DURING_DEPLOY + SCRIPT_CONNECTIONS);

/** core ② 가 클레임·헤더 없는 공개 요청에 내는 문구(`core-request-tenant.interceptor.ts`) */
export const GATE_REJECT_MESSAGE = '테넌트 헤더가 없습니다.';
/** 클레임 없이 부를 core 공개 라우트 — DB 를 읽어 ① 이면 200, ② 면 위 문구로 403 */
export const CLAIMLESS_CORE_PATH = '/notices/public';

export interface StartObservation {
  /** `aws rds describe-db-instances` 의 DBInstanceClass. 엔드포인트로 못 찾으면 null */
  rdsInstanceClass: string | null;
  /** `SHOW max_connections`, 예약분(superuser + rds_superuser), `pg_stat_activity` 의 클라이언트 연결 수 */
  connections: { max: number; reserved: number; inUse: number };
  claimlessCoreProbe: { status: number; body: unknown };
  hostedZones: { host: string; zoneId: string | null }[];
}

const SMALL_SIZES = new Set(['nano', 'micro', 'small']);

export function startConditionProblems(o: StartObservation): string[] {
  const problems: string[] = [];

  const size = o.rdsInstanceClass?.split('.').at(-1);
  if (!o.rdsInstanceClass || !size) {
    problems.push('RDS 인스턴스를 엔드포인트로 못 찾았다 — 터널·AWS 로그인을 확인한다');
  } else if (SMALL_SIZES.has(size)) {
    problems.push(
      `RDS 가 ${o.rdsInstanceClass} 다 — medium 이상이어야 한다(테넌트 DB 하나가 core 풀 한 벌을 더 연다). deployments/lcnine/services/infra/shared.ts 의 Db instance 를 올려 배포`,
    );
  }

  const free = o.connections.max - o.connections.reserved - o.connections.inUse;
  if (free < REQUIRED_FREE_CONNECTIONS) {
    problems.push(
      `연결 여유 ${free} < ${REQUIRED_FREE_CONNECTIONS} (max ${o.connections.max} · 예약 ${o.connections.reserved} · 사용 ${o.connections.inUse}) — 테넌트 한 벌의 두 배가 남아야 한다`,
    );
  }

  const p = o.claimlessCoreProbe;
  const message = typeof p.body === 'object' && p.body !== null ? (p.body as { message?: unknown }).message : undefined;
  if (!(p.status === 403 && message === GATE_REJECT_MESSAGE)) {
    problems.push(
      `배포 ② 가 라이브가 아니다 — 클레임 없는 GET ${CLAIMLESS_CORE_PATH} 가 ${p.status}${
        p.status >= 200 && p.status < 300 ? '(통과 = ① 의 core)' : ` «${String(message ?? '')}»`
      }. ② 의 core 는 403 «${GATE_REJECT_MESSAGE}» 이다`,
    );
  }

  for (const z of o.hostedZones) {
    if (!z.zoneId)
      problems.push(
        `${z.host} 의 Route53 공개 호스팅 존이 없다 — 도메인 DNS 를 Route53 으로 먼저 옮긴다(27 사전 작업)`,
      );
  }
  return problems;
}
