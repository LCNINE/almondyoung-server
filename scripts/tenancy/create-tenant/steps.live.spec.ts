import { StepPaused, StepRefused, type CreationStep } from './runner';
import {
  buildCreationSteps,
  type CreationPorts,
  type OperatorApi,
  type TenantMasterApi,
  type TenantPlan,
} from './steps';
import { stub } from './stub-port';

/**
 * 라이브에서만 붙는 단계 — 버킷 접근 권한·인증서·칸 Secret(사람 손)·직원 계정. 로컬 포트(이 넷이 없다)로 짜면
 * 23 의 단계 그대로다. 직원 계정은 «활성 + 격리 실측 통과»를 그 자리에서 확인한 뒤에만 만든다.
 */
const plan: TenantPlan = {
  entry: {
    id: '2',
    slug: 'acme',
    coreDb: 'core_acme',
    publicBucket: 'acme-public-x1',
    privateBucket: 'acme-private-x1',
  },
  displayName: '에이크미',
  domains: [
    { host: 'admin.acme.test', app: 'admin-web' },
    { host: 'login.acme.test', app: 'auth-web' },
  ],
  staffClient: { clientId: 'admin-web', redirectUris: [], postLogoutRedirectUris: [] },
  role: { name: 'r', displayName: 'r', description: 'r', landingPath: '/', permissions: [] },
  checkAccount: { loginId: 'check', username: 'c', nickname: 'c', email: 'c@example.test' },
  staff: [{ loginId: 'kim', username: '김직원', email: 'kim@acme.test' }],
};

const localPorts = (operator: OperatorApi = stub('operator')): CreationPorts => ({
  operator,
  tenantOneCoreDb: 'core',
  databases: stub('databases'),
  buckets: stub('buckets'),
  list: stub('list'),
  deployment: stub<CreationPorts['deployment']>('deployment', { describe: () => '배포' }),
  checkSecret: stub('checkSecret'),
});

const livePorts = (over: Partial<CreationPorts> = {}): CreationPorts => ({
  ...localPorts(),
  bucketAccess: stub<NonNullable<CreationPorts['bucketAccess']>>('bucketAccess'),
  certificates: stub<NonNullable<CreationPorts['certificates']>>('certificates'),
  domainSlotSecrets: stub<NonNullable<CreationPorts['domainSlotSecrets']>>('domainSlotSecrets'),
  isolation: stub<NonNullable<CreationPorts['isolation']>>('isolation'),
  printInitialPassword: () => undefined,
  ...over,
});

const stepNamed = (steps: CreationStep[], prefix: string) => {
  const step = steps.find((s) => s.name.startsWith(prefix));
  if (!step) throw new Error(`«${prefix}» 단계가 없다`);
  return step;
};

describe('라이브 단계의 자리', () => {
  it('로컬 포트로는 23 의 단계 그대로다 — 라이브 단계가 끼지 않는다', () => {
    const { staff: _staff, ...localPlan } = plan;
    const names = buildCreationSteps(localPlan, localPorts()).map((s) => s.name);
    expect(names.some((n) => /접근 권한|인증서|칸 Secret|직원 계정/.test(n))).toBe(false);
  });

  it('권한·인증서는 버킷 뒤, 칸 Secret 은 목록 바로 앞, 직원 계정은 «활성» 뒤 맨 끝', () => {
    const names = buildCreationSteps(plan, livePorts()).map((s) => s.name);
    const at = (prefix: string) => names.findIndex((n) => n.startsWith(prefix));

    expect(at('버킷 접근 권한')).toBe(at('버킷 둘') + 1);
    expect(at('인증서')).toBe(at('버킷 접근 권한') + 1);
    expect(at('테넌트 도메인 칸 Secret')).toBe(at('테넌트 목록에 넣기') - 1);
    expect(at('직원 계정')).toBe(names.length - 1);
    expect(at('직원 계정')).toBe(at('만든 직후 확인') + 1);
  });

  it('인증서 단계는 계획의 도메인마다 발급을 본다 — 하나라도 안 됐으면 안 된 것만 요청한다', async () => {
    const requested: string[] = [];
    const issued = new Set(['admin.acme.test']);
    const step = stepNamed(
      buildCreationSteps(
        plan,
        livePorts({
          certificates: {
            issued: async (host) => issued.has(host),
            request: async (host) => {
              requested.push(host);
              issued.add(host);
            },
          },
        }),
      ),
      '인증서',
    );

    expect(await step.isDone()).toBe(false);
    await step.run();
    expect(requested).toEqual(['login.acme.test']);
    expect(await step.isDone()).toBe(true);
  });
});

describe('직원 계정 단계', () => {
  // 운영자가 아니라 그 테넌트의 점검 master 가 만든다(ADR-0056) — 운영자 포트는 테넌트 상태·역할만 본다.
  const operatorFor = (status: 'preparing' | 'active') =>
    stub<OperatorApi>('operator', {
      getTenant: async () => ({ slug: 'acme', status, domains: [] }),
      findRole: async () => ({ roleId: 'role-1', version: 1, landingPath: '/', permissions: [] }),
    });

  function world(opts: { status: 'preparing' | 'active'; isolationPasses: boolean; taken?: string[] }) {
    const created: { loginId: string; roleId: string }[] = [];
    const printed: string[] = [];
    const members: string[] = [];
    const tenantMaster: TenantMasterApi = {
      roleMemberLoginIds: async () => members,
      async createStaff(input) {
        if (opts.taken?.includes(input.loginId)) return null;
        created.push({ loginId: input.loginId, roleId: input.roleId });
        members.push(input.loginId);
        return { userId: `u-${input.loginId}`, initialPassword: `pw-${input.loginId}` };
      },
    };
    let isolationRuns = 0;
    const step = stepNamed(
      buildCreationSteps(
        plan,
        livePorts({
          operator: operatorFor(opts.status),
          tenantMaster,
          isolation: {
            passes: async () => {
              isolationRuns++;
              return opts.isolationPasses;
            },
            suspendCommand: 'npm run tenant:create -- --stage live --plan <계획> --suspend',
          },
          printInitialPassword: (loginId, password) => printed.push(`${loginId}:${password}`),
        }),
      ),
      '직원 계정',
    );
    return { step, created, printed, isolationRuns: () => isolationRuns };
  }

  it('«활성 + 격리 실측 통과»면 점검 master 가 명단대로 만들고, 초기 비밀번호를 한 번 출력한다', async () => {
    const w = world({ status: 'active', isolationPasses: true });

    expect(await w.step.isDone()).toBe(false);
    await w.step.run();

    expect(w.created).toEqual([{ loginId: 'kim', roleId: 'role-1' }]);
    expect(w.printed).toEqual(['kim:pw-kim']);
    expect(await w.step.isDone()).toBe(true);
  });

  it('«활성»이 아니면 실측도 계정도 없이 멈춘다 — 그 전엔 점검 master 가 로그인할 수 없다', async () => {
    const w = world({ status: 'preparing', isolationPasses: true });

    expect(await w.step.isDone()).toBe(false);
    await expect(w.step.run()).rejects.toThrow(/활성/);
    expect(w.isolationRuns()).toBe(0);
    expect(w.created).toEqual([]);
  });

  it('격리 실측이 실패하면 계정을 만들지 않고 «정지» 명령을 안내한다', async () => {
    const w = world({ status: 'active', isolationPasses: false });

    await expect(w.step.run()).rejects.toThrow(/--suspend/);
    expect(w.created).toEqual([]);
    expect(w.printed).toEqual([]);
  });

  it('명단의 아이디를 이 테넌트의 다른 계정이 쓰면 멈춘다', async () => {
    const w = world({ status: 'active', isolationPasses: true, taken: ['kim'] });

    await expect(w.step.run()).rejects.toBeInstanceOf(StepRefused);
    expect(w.printed).toEqual([]);
  });
});

describe('칸 Secret 단계', () => {
  it('Secret 이 아직이면 사람 손 단계로 멈춘다(실패·되돌리기가 아니다)', async () => {
    const step = stepNamed(
      buildCreationSteps(
        plan,
        livePorts({
          domainSlotSecrets: {
            isDone: async () => false,
            pause: async () => {
              throw new StepPaused(['할 일']);
            },
          },
        }),
      ),
      '테넌트 도메인 칸 Secret',
    );

    expect(await step.isDone()).toBe(false);
    await expect(step.run()).rejects.toBeInstanceOf(StepPaused);
  });
});

describe('배포 단계', () => {
  it('어댑터가 «섬기는가»를 주면 크론 행만으로 «됐다»가 아니다 — 남의 배포가 목록만 실어도 표 커밋·배포 멈춤을 건너뛰지 않는다', async () => {
    let serving = false;
    const step = stepNamed(
      buildCreationSteps(
        plan,
        livePorts({
          operator: stub<OperatorApi>('operator', {
            getTenant: async () => ({ slug: 'acme', status: 'preparing', domains: [] }),
          }),
          databases: stub<CreationPorts['databases']>('databases', {
            cronRuns: async () => ({ rows: 12, duplicatedPeriods: 0 }),
          }),
          deployment: {
            describe: () => '배포 한 번',
            isServing: async () => serving,
            run: async () => {
              throw new StepPaused(['표 커밋 → 배포']);
            },
          },
        }),
      ),
      '배포 한 번',
    );

    expect(await step.isDone()).toBe(false);
    serving = true;
    expect(await step.isDone()).toBe(true);
  });
});
