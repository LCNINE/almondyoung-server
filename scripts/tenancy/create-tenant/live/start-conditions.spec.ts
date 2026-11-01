import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CORE_POOL_PER_TENANT,
  GATE_REJECT_MESSAGE,
  REQUIRED_FREE_CONNECTIONS,
  startConditionProblems,
  type StartObservation,
} from './start-conditions';

/**
 * 시작 조건 — 하나라도 틀리면 아무것도 만들지 않는다. 판정은 관측값으로만 한다: ② 는 태그·기억이 아니라
 * 클레임 없는 요청을 core 가 실제로 거절했는지로 본다.
 */
const ROOT = join(__dirname, '../../../..');

const healthy: StartObservation = {
  rdsInstanceClass: 'db.t4g.medium',
  connections: { max: 410, reserved: 5, inUse: 190 },
  claimlessCoreProbe: { status: 403, body: { message: GATE_REJECT_MESSAGE } },
  hostedZones: [
    { host: 'admin.acme.test', zoneId: 'Z1' },
    { host: 'login.acme.test', zoneId: 'Z1' },
  ],
};

describe('시작 조건', () => {
  it('medium + 여유 + ② + 존이 다 있으면 시작한다', () => {
    expect(startConditionProblems(healthy)).toEqual([]);
  });

  it.each(['db.t4g.micro', 'db.t4g.small', 'db.t3.small'])('RDS %s 는 거절한다', (cls) => {
    expect(startConditionProblems({ ...healthy, rdsInstanceClass: cls }).join()).toMatch(/medium/);
  });

  it.each(['db.t4g.large', 'db.m7g.xlarge', 'db.r6g.2xlarge'])('RDS %s 는 통과', (cls) => {
    expect(startConditionProblems({ ...healthy, rdsInstanceClass: cls })).toEqual([]);
  });

  it('인스턴스를 못 찾았으면 거절한다', () => {
    expect(startConditionProblems({ ...healthy, rdsInstanceClass: null }).join()).toMatch(/RDS/);
  });

  it('연결 여유가 테넌트 한 벌의 두 배보다 작으면 거절한다 — t4g.small(≈225) 의 오늘 사용량이 그 자리다', () => {
    expect(startConditionProblems({ ...healthy, connections: { max: 225, reserved: 5, inUse: 190 } }).join()).toMatch(
      /연결 여유/,
    );
    const justEnough = { max: 5 + 190 + REQUIRED_FREE_CONNECTIONS, reserved: 5, inUse: 190 };
    expect(startConditionProblems({ ...healthy, connections: justEnough })).toEqual([]);
  });

  it('클레임 없는 요청이 통과하면(① 의 core) 거절한다', () => {
    const problems = startConditionProblems({ ...healthy, claimlessCoreProbe: { status: 200, body: [] } });
    expect(problems.join()).toMatch(/배포 ②/);
  });

  it('다른 403(문구가 다르다)은 ② 의 증거가 아니다', () => {
    const problems = startConditionProblems({
      ...healthy,
      claimlessCoreProbe: { status: 403, body: { message: 'Forbidden' } },
    });
    expect(problems.join()).toMatch(/배포 ②/);
  });

  it('도메인의 Route53 존이 없으면 거절한다 — 인증서 검증 레코드를 넣을 곳이 없다', () => {
    const problems = startConditionProblems({
      ...healthy,
      hostedZones: [
        { host: 'admin.acme.test', zoneId: 'Z1' },
        { host: 'login.acme.test', zoneId: null },
      ],
    });
    expect(problems).toEqual([expect.stringMatching(/login\.acme\.test.*Route53/)]);
  });
});

describe('시작 조건이 기대는 소스', () => {
  it('core ② 의 거절 문구가 core 요청 문에 있다', () => {
    const src = readFileSync(join(ROOT, 'apps/core/src/platform/tenancy/core-request-tenant.interceptor.ts'), 'utf8');
    expect(src).toContain(GATE_REJECT_MESSAGE);
  });

  it('테넌트 한 벌의 풀 크기가 DbService 의 라우팅 풀 크기와 같다', () => {
    const src = readFileSync(join(ROOT, 'libs/db/src/db.service.ts'), 'utf8');
    expect(src).toContain(`const ROUTED_POOL_MAX = ${CORE_POOL_PER_TENANT};`);
  });
});
