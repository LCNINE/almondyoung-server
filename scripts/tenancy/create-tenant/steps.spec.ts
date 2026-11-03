import { StepRefused, type CreationStep } from './runner';
import { stub } from './stub-port';
import {
  buildCreationSteps,
  type CreationPorts,
  type OperatorApi,
  type TenantDomainApp,
  type TenantPlan,
} from './steps';

/**
 * 테넌트 도메인은 admin-web 주소와 auth-web 주소 둘이다(CloudFront 배포가 앱마다 하나). 계획의 도메인이 나중에 늘어도 —
 * 이미 만든 테넌트에 auth-web 주소를 처음 붙일 때처럼 — 다시 돌리면 빠진 도메인만 붙는다. 앱이 빈 도메인(앱 칸 전에 붙인 것)도
 * 다시 붙여 앱을 채운다 — admin-web 테넌트 셸이 그 앱으로 로그인 주소를 고른다.
 */
const plan: TenantPlan = {
  entry: {
    id: '2',
    slug: 'rehearsal',
    coreDb: 'core_rehearsal',
    publicBucket: 'rehearsal-public',
    privateBucket: 'rehearsal-private',
  },
  displayName: '리허설 상사',
  domains: [
    { host: 'rehearsal.localhost:8002', app: 'admin-web' },
    { host: 'rehearsal.localhost:8001', app: 'auth-web' },
  ],
  staffClient: { clientId: 'admin-web', redirectUris: [], postLogoutRedirectUris: [] },
  role: { name: 'r', displayName: 'r', description: 'r', landingPath: '/', permissions: [] },
  checkAccount: { loginId: 'c', username: 'c', nickname: 'c', email: 'c@example.test' },
};

type Domain = { host: string; app: TenantDomainApp | null };

function fakeOperator(tenant: { status: 'preparing' | 'active'; domains: Domain[] } | null) {
  const added: string[] = [];
  const operator = stub<OperatorApi>('operator', {
    async getTenant(id: string) {
      return tenant && id === '2' ? { slug: 'rehearsal', ...tenant } : null;
    },
    async addDomain(tenantId: string, domain: { host: string; app: TenantDomainApp }) {
      if (!tenant || tenantId !== '2') throw new Error('없는 테넌트');
      tenant.domains = [...tenant.domains.filter((d) => d.host !== domain.host), domain];
      added.push(domain.host);
    },
  });
  return { operator, added };
}

const portsWith = (operator: OperatorApi): CreationPorts => ({
  operator,
  tenantOneCoreDb: 'dev_core',
  databases: stub('databases'),
  buckets: stub('buckets'),
  list: stub('list'),
  deployment: stub<CreationPorts['deployment']>('deployment', { describe: () => '로컬 배포' }),
  checkSecret: stub('checkSecret'),
});

const domainStep = (operator: OperatorApi): CreationStep => {
  const step = buildCreationSteps(plan, portsWith(operator)).find((s) => s.name.startsWith('테넌트 도메인 붙이기'));
  if (!step) throw new Error('도메인 단계가 없다');
  return step;
};

describe('테넌트 도메인 단계', () => {
  it('이미 활성인 테넌트에 계획의 빠진 도메인만 붙인다', async () => {
    const { operator, added } = fakeOperator({
      status: 'active',
      domains: [{ host: 'rehearsal.localhost:8002', app: 'admin-web' }],
    });
    const step = domainStep(operator);

    expect(await step.isDone()).toBe(false);
    await step.run();

    expect(added).toEqual(['rehearsal.localhost:8001']);
    expect(await step.isDone()).toBe(true);
  });

  it('계획의 도메인이 다 있으면 «이미 됐다»', async () => {
    const { operator } = fakeOperator({
      status: 'active',
      domains: [
        { host: 'rehearsal.localhost:8001', app: 'auth-web' },
        { host: 'rehearsal.localhost:8002', app: 'admin-web' },
      ],
    });
    expect(await domainStep(operator).isDone()).toBe(true);
  });

  it('앱이 빈 도메인은 다시 붙여 앱을 채운다', async () => {
    const { operator, added } = fakeOperator({
      status: 'active',
      domains: [
        { host: 'rehearsal.localhost:8001', app: null },
        { host: 'rehearsal.localhost:8002', app: 'admin-web' },
      ],
    });
    const step = domainStep(operator);

    expect(await step.isDone()).toBe(false);
    await step.run();

    expect(added).toEqual(['rehearsal.localhost:8001']);
    expect(await step.isDone()).toBe(true);
  });

  it('행 단계 뒤에 온다 — 행이 없으면 붙일 곳이 없다', async () => {
    const names = buildCreationSteps(plan, portsWith(fakeOperator(null).operator)).map((s) => s.name);
    expect(names.findIndex((n) => n.startsWith('테넌트 도메인 붙이기'))).toBe(
      names.findIndex((n) => n.startsWith('테넌트 행')) + 1,
    );
  });
});

/**
 * 점검 계정은 그 테넌트의 첫 master 다(ADR-0056) — 운영자가 다른 테넌트 계정에 닿는 두 일(첫 master 만들기·master 비번 비상
 * 초기화)로만 만들고 이어 간다. 비밀번호는 Secret 에만, 변경 강제 없음.
 */
describe('첫 master (점검 계정) 단계', () => {
  function world(start: { masters?: { userId: string; loginId: string }[]; secret?: boolean } = {}) {
    let masters = start.masters ?? [];
    let saved: { loginId: string; password: string } | null = start.secret ? { loginId: 'c', password: 'old' } : null;
    const calls: string[] = [];
    const operator = stub<OperatorApi>('operator', {
      tenantMasters: async () => masters,
      async createFirstMaster(tenantId, input) {
        calls.push(`create ${tenantId} ${input.loginId} force=${input.forcePasswordChange}`);
        masters = [...masters, { userId: 'u-c', loginId: input.loginId }];
        return { userId: 'u-c', initialPassword: 'pw-new' };
      },
      async resetMasterPassword(tenantId, userId, force) {
        calls.push(`reset ${tenantId} ${userId} force=${force}`);
        return 'pw-reset';
      },
    });
    const ports: CreationPorts = {
      ...portsWith(operator),
      checkSecret: {
        has: async () => saved !== null,
        save: async (loginId, password) => {
          saved = { loginId, password };
        },
      },
    };
    const steps = buildCreationSteps(plan, ports);
    const step = steps.find((s) => s.name.startsWith('첫 master'));
    if (!step) throw new Error('첫 master 단계가 없다');
    return { step, steps, calls, saved: () => saved };
  }

  it('master 가 없으면 점검 계정을 첫 master 로 만들고(변경 강제 없음) 비밀번호를 Secret 에 둔다', async () => {
    const w = world();

    expect(await w.step.isDone()).toBe(false);
    await w.step.run();

    expect(w.calls).toEqual(['create 2 c force=false']);
    expect(w.saved()).toEqual({ loginId: 'c', password: 'pw-new' });
    expect(await w.step.isDone()).toBe(true);
  });

  it('그 아이디의 master 가 있는데 Secret 이 비었으면 비상 초기화로 비밀번호를 다시 받는다', async () => {
    const w = world({ masters: [{ userId: 'u-c', loginId: 'c' }] });

    expect(await w.step.isDone()).toBe(false);
    await w.step.run();

    expect(w.calls).toEqual(['reset 2 u-c force=false']);
    expect(w.saved()).toEqual({ loginId: 'c', password: 'pw-reset' });
  });

  it('그 아이디의 master 와 Secret 이 다 있으면 «이미 됐다»', async () => {
    expect(await world({ masters: [{ userId: 'u-c', loginId: 'c' }], secret: true }).step.isDone()).toBe(true);
  });

  it('다른 아이디의 master 가 있으면 손대지 않는다 — 그 테넌트의 직원은 그 master 의 것이다', async () => {
    const w = world({ masters: [{ userId: 'u-boss', loginId: 'boss' }] });

    await expect(w.step.run()).rejects.toBeInstanceOf(StepRefused);
    expect(w.calls).toEqual([]);
  });

  it('목록에 넣은 뒤에 온다 — 계정이 생긴 테넌트는 되돌리기로 지울 수 없다', () => {
    const names = world().steps.map((s) => s.name);
    expect(names.findIndex((n) => n.startsWith('첫 master'))).toBe(
      names.findIndex((n) => n.startsWith('테넌트 목록에 넣기')) + 1,
    );
  });
});
