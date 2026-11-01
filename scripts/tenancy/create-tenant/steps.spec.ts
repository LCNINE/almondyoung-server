import type { CreationStep } from './runner';
import { buildCreationSteps, type CreationPorts, type OperatorApi, type TenantPlan } from './steps';

/**
 * 테넌트 도메인은 admin-web 주소와 auth-web 주소 둘이다(CloudFront 배포가 앱마다 하나). 계획의 도메인이 나중에 늘어도 —
 * 이미 만든 테넌트에 auth-web 주소를 처음 붙일 때처럼 — 다시 돌리면 빠진 도메인만 붙는다.
 */
const plan: TenantPlan = {
  entry: { id: '2', slug: 'rehearsal', coreDb: 'core_rehearsal', publicBucket: 'rehearsal-public', privateBucket: 'rehearsal-private' },
  displayName: '리허설 상사',
  domains: ['rehearsal.localhost:8002', 'rehearsal.localhost:8001'],
  staffClient: { clientId: 'admin-web', redirectUris: [], postLogoutRedirectUris: [] },
  role: { name: 'r', displayName: 'r', description: 'r', landingPath: '/', permissions: [] },
  checkAccount: { loginId: 'c', username: 'c', nickname: 'c', email: 'c@example.test' },
};

/**
 * 이 spec 이 쓰는 메서드만 채운 포트. 나머지는 부르면 던진다 — 도메인 단계가 다른 포트를 건드리면 빨갛게.
 * 포트 인터페이스를 다 채우지 않으려고 Proxy 를 쓰고, 그 때문에 한 번만 `as T` 로 넓힌다.
 */
function stub<T extends object>(name: string, impl: Partial<T> = {}): T {
  return new Proxy(impl, {
    get(target, prop: string) {
      if (prop in target) return target[prop as keyof T];
      return () => {
        throw new Error(`이 spec 은 ${name}.${prop} 을 부르지 않는다`);
      };
    },
  }) as T;
}

function fakeOperator(tenant: { status: 'preparing' | 'active'; domains: string[] } | null) {
  const added: string[] = [];
  const operator = stub<OperatorApi>('operator', {
    async getTenant(id: string) {
      return tenant && id === '2' ? { slug: 'rehearsal', ...tenant } : null;
    },
    async addDomain(tenantId: string, host: string) {
      if (!tenant || tenantId !== '2') throw new Error('없는 테넌트');
      tenant.domains.push(host);
      added.push(host);
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
    const { operator, added } = fakeOperator({ status: 'active', domains: ['rehearsal.localhost:8002'] });
    const step = domainStep(operator);

    expect(await step.isDone()).toBe(false);
    await step.run();

    expect(added).toEqual(['rehearsal.localhost:8001']);
    expect(await step.isDone()).toBe(true);
  });

  it('계획의 도메인이 다 있으면 «이미 됐다»', async () => {
    const { operator } = fakeOperator({ status: 'active', domains: ['rehearsal.localhost:8001', 'rehearsal.localhost:8002'] });
    expect(await domainStep(operator).isDone()).toBe(true);
  });

  it('행 단계 뒤에 온다 — 행이 없으면 붙일 곳이 없다', async () => {
    const names = buildCreationSteps(plan, portsWith(fakeOperator(null).operator)).map((s) => s.name);
    expect(names.findIndex((n) => n.startsWith('테넌트 도메인 붙이기'))).toBe(
      names.findIndex((n) => n.startsWith('테넌트 행')) + 1,
    );
  });
});
