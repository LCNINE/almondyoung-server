import { parseTenantList, type TenantEntry } from '../../../libs/tenancy/src/tenant-list';
import { messageOf, StepRefused, type CreationStep } from './runner';

/**
 * 테넌트 하나를 만드는 단계들. 환경(로컬·라이브)마다 다른 것은 아래 포트의 어댑터뿐이다 —
 * 로컬은 `scripts/local/create-tenant/`. 라이브 어댑터(RDS·S3·Secret·배포)는 아직 없다.
 *
 * 🔴 역할·계정·소속·부여는 `OperatorApi`(iam Manager 를 거치는 운영자 API)로만 만든다. user-service DB 에 직접 쓰지 않는다 —
 * 권한 상승 방지와 변경 이력이 그 길에만 있다.
 */
export interface TenantPlan {
  entry: TenantEntry;
  displayName: string;
  /** 테넌트 도메인(host, 포트 포함)과 그 앱 — admin-web 주소와 auth-web 주소 둘(CloudFront 배포가 앱마다 하나) */
  domains: TenantDomain[];
  staffClient: { clientId: string; redirectUris: string[]; postLogoutRedirectUris: string[] };
  /** 역할은 전역이다 — 이름은 테넌트 이름이 아닌 일반 이름 */
  role: { name: string; displayName: string; description: string; landingPath: string; permissions: string[] };
  /** 점검 계정 — 비밀번호 변경 강제 없음, 비밀번호는 `CheckAccountSecret` 에만 */
  checkAccount: { loginId: string; username: string; nickname: string; email: string };
}

export type TenantStatus = 'preparing' | 'active' | 'suspended';

/** user-service `TENANT_DOMAIN_APPS` 의 사본 — 스크립트는 HTTP 로만 부른다. admin-web 테넌트 셸이 이 앱으로 로그인 주소를 고른다. */
export type TenantDomainApp = 'admin-web' | 'auth-web';

export interface TenantDomain {
  host: string;
  app: TenantDomainApp;
}

export interface OperatorApi {
  /** 도메인의 app 이 null 이면 앱 칸 전에 붙인 도메인이다 */
  getTenant(
    id: string,
  ): Promise<{ slug: string; status: TenantStatus; domains: { host: string; app: TenantDomainApp | null }[] } | null>;
  createTenant(input: { id: string; slug: string; displayName: string; domains: TenantDomain[] }): Promise<void>;
  /** 준비 상태만 지워진다(소속·부여·도메인·리디렉트 주소는 user-service 가 함께 걷는다) */
  deleteTenant(id: string): Promise<void>;
  /** 이미 있는 테넌트에 도메인 하나 — 이미 그 테넌트 것이고 앱이 같으면 아무것도 안 한다, 앱이 비었으면 채운다 */
  addDomain(tenantId: string, domain: TenantDomain): Promise<void>;
  setTenantStatus(id: string, status: 'active' | 'suspended'): Promise<void>;
  staffClientUris(clientId: string): Promise<{ redirectUris: string[]; postLogoutRedirectUris: string[] }>;
  addStaffClientUris(
    tenantId: string,
    clientId: string,
    uris: { redirectUris: string[]; postLogoutRedirectUris: string[] },
  ): Promise<void>;
  findRole(
    name: string,
  ): Promise<{ roleId: string; version: number; landingPath: string | null; permissions: string[] } | null>;
  createRole(input: TenantPlan['role'] & { tenantId: string }): Promise<void>;
  replaceRolePermissions(roleId: string, permissions: string[], version: number): Promise<void>;
  setRoleLandingPath(roleId: string, landingPath: string): Promise<void>;
  /** 그 역할을 받은 사람(테넌트를 가리지 않는다 — 운영자 API 의 역할 구성원 조회가 테넌트를 안 싣는다) */
  roleMemberLoginIds(roleId: string): Promise<string[]>;
  findUserIdByLoginId(loginId: string): Promise<string | null>;
  createStaff(
    input: TenantPlan['checkAccount'] & { roleId: string; tenantId: string; forcePasswordChange: boolean },
  ): Promise<{ userId: string; initialPassword: string }>;
  addMember(tenantId: string, userId: string): Promise<void>;
  addRoleMembers(roleId: string, tenantId: string, userIds: string[]): Promise<void>;
  reissuePassword(tenantId: string, userId: string, forcePasswordChange: boolean): Promise<string>;
}

const hasDomain = (mine: readonly { host: string; app: TenantDomainApp | null }[], d: TenantDomain) =>
  mine.some((m) => m.host === d.host.toLowerCase() && m.app === d.app);

export interface CoreDatabases {
  exists(db: string): Promise<boolean>;
  create(db: string): Promise<void>;
  drop(db: string): Promise<void>;
  migrate(db: string): Promise<void>;
  /** 적용된 마이그의 식별(해시) 집합 */
  appliedMigrations(db: string): Promise<string[]>;
  /** 레포에 있는 마이그 수 — 새 DB 가 다 받았는지 */
  repoMigrationCount(): number;
  /** «모든 테넌트» 참조 시드 */
  allTenantsSeedDone(db: string): Promise<boolean>;
  seedAllTenants(db: string): Promise<void>;
  warehouseCount(db: string): Promise<number>;
  /** cron_runs 행 수와, 한 주기에 두 행 이상인 (name, period_at) 수 */
  cronRuns(db: string): Promise<{ rows: number; duplicatedPeriods: number }>;
}

export interface Buckets {
  exists(bucket: string): Promise<boolean>;
  create(bucket: string): Promise<void>;
  /** 비어 있을 때만 지운다 */
  removeIfEmpty(bucket: string): Promise<void>;
  /** 써 보고 읽어 보고 지운다 — 안 되면 던진다 */
  probe(bucket: string): Promise<void>;
}

/** 테넌트 목록(라이브 = Secret, 로컬 = 앱 .env 들) */
export interface TenantListTarget {
  lists(entry: TenantEntry): Promise<boolean>;
  add(entry: TenantEntry): Promise<void>;
  remove(tenantId: string): Promise<void>;
}

/** 목록을 받은 앱이 그 테넌트를 섬기게 한다(라이브 = 배포, 로컬 = core 를 ② 로 띄워 크론 한 주기) */
export interface Deployment {
  describe(): string;
  run(entry: TenantEntry): Promise<void>;
}

export interface CheckAccountSecret {
  has(): Promise<boolean>;
  save(loginId: string, password: string): Promise<void>;
}

export interface CreationPorts {
  operator: OperatorApi;
  /** 테넌트 1 의 core DB — 마이그 버전 비교 기준 */
  tenantOneCoreDb: string;
  databases: CoreDatabases;
  buckets: Buckets;
  list: TenantListTarget;
  deployment: Deployment;
  checkSecret: CheckAccountSecret;
}

export function buildCreationSteps(plan: TenantPlan, ports: CreationPorts): CreationStep[] {
  const { entry } = plan;
  // 목록 항목은 앱과 같은 파서로 «시작하기 전에» 본다 — 틀린 버킷·slug 를 목록 단계에서야 알면 그 앞을 다 만들고 되돌린다.
  parseTenantList(JSON.stringify([entry]));
  const { operator, databases: dbs, buckets } = ports;
  const db = entry.coreDb;
  const bucketNames = [...new Set([entry.publicBucket, entry.privateBucket])];
  // 이 계획의 테넌트일 때만 상태를 돌려준다. 같은 id 의 다른 테넌트면 거절 — 되돌리기가 남의 행을 지우지 않게.
  const ourTenant = async () => {
    const t = await operator.getTenant(entry.id);
    if (t && t.slug !== entry.slug) throw new StepRefused(`테넌트 ${entry.id} 가 다른 slug 로 이미 있다 — 손대지 않는다`);
    return t;
  };
  const tenantStatus = async () => (await ourTenant())?.status ?? null;
  const roleOk = async () => {
    const role = await operator.findRole(plan.role.name);
    return (
      !!role && sameSet(role.permissions, plan.role.permissions) && role.landingPath === plan.role.landingPath
    );
  };
  const roleId = async () => {
    const role = await operator.findRole(plan.role.name);
    if (!role) throw new Error(`역할 ${plan.role.name} 이 없다`);
    return role.roleId;
  };
  const migratedLikeTenantOne = async () => {
    const [mine, theirs] = await Promise.all([dbs.appliedMigrations(db), dbs.appliedMigrations(ports.tenantOneCoreDb)]);
    return { mine, theirs, same: sameSet(mine, theirs) };
  };

  return [
    {
      name: `테넌트 행 «준비» (${entry.id})`,
      isDone: async () => !!(await ourTenant()),
      run: () => operator.createTenant({ id: entry.id, slug: entry.slug, displayName: plan.displayName, domains: plan.domains }),
      async undo() {
        const status = await tenantStatus();
        if (status === 'preparing') await operator.deleteTenant(entry.id);
        else if (status) throw new Error(`테넌트 ${entry.id} 가 «${status}» 라 지우지 않는다`);
      },
    },
    {
      // 행 단계는 «행이 있나»만 본다 — 계획의 도메인이 나중에 늘면(auth-web 주소) 이 단계가 이미 있는 테넌트에 붙인다.
      // 되돌리기는 행 삭제가 도메인째 걷는다.
      name: `테넌트 도메인 붙이기 (${plan.domains.map((d) => `${d.host} ${d.app}`).join(', ')})`,
      isDone: async () => {
        const mine = (await ourTenant())?.domains ?? [];
        return plan.domains.every((d) => hasDomain(mine, d));
      },
      async run() {
        const mine = (await ourTenant())?.domains ?? [];
        for (const d of plan.domains) if (!hasDomain(mine, d)) await operator.addDomain(entry.id, d);
      },
    },
    {
      name: `core DB 만들기 (${db})`,
      isDone: () => dbs.exists(db),
      run: () => dbs.create(db),
      async undo() {
        if (await dbs.exists(db)) await dbs.drop(db);
      },
    },
    {
      name: `core DB 마이그 (${db})`,
      isDone: async () => (await dbs.appliedMigrations(db)).length === dbs.repoMigrationCount(),
      run: () => dbs.migrate(db),
    },
    {
      name: `«모든 테넌트» 참조 시드 (${db})`,
      isDone: () => dbs.allTenantsSeedDone(db),
      run: () => dbs.seedAllTenants(db),
    },
    {
      name: `버킷 둘 (${bucketNames.join(', ')})`,
      isDone: async () => (await Promise.all(bucketNames.map((b) => buckets.exists(b)))).every(Boolean),
      async run() {
        for (const b of bucketNames) if (!(await buckets.exists(b))) await buckets.create(b);
      },
      async undo() {
        for (const b of bucketNames) await buckets.removeIfEmpty(b);
      },
    },
    {
      // 테넌트 행이 지워지면 이 주소도 함께 걷힌다 — 되돌리기는 행 단계가 한다.
      name: `테넌트 도메인 리디렉트 등록 (${plan.staffClient.clientId})`,
      async isDone() {
        const now = await operator.staffClientUris(plan.staffClient.clientId);
        return (
          plan.staffClient.redirectUris.every((u) => now.redirectUris.includes(u)) &&
          plan.staffClient.postLogoutRedirectUris.every((u) => now.postLogoutRedirectUris.includes(u))
        );
      },
      run: () =>
        operator.addStaffClientUris(entry.id, plan.staffClient.clientId, {
          redirectUris: plan.staffClient.redirectUris,
          postLogoutRedirectUris: plan.staffClient.postLogoutRedirectUris,
        }),
    },
    {
      // 역할은 전역이라 되돌리지 않는다 — 다시 돌리면 그대로 쓴다.
      name: `역할 ${plan.role.name} (키 ${plan.role.permissions.length}개, 첫 화면 ${plan.role.landingPath})`,
      isDone: roleOk,
      async run() {
        const role = await operator.findRole(plan.role.name);
        if (!role) {
          await operator.createRole({ ...plan.role, tenantId: entry.id });
          return;
        }
        if (!sameSet(role.permissions, plan.role.permissions)) {
          await operator.replaceRolePermissions(role.roleId, plan.role.permissions, role.version);
        }
        if (role.landingPath !== plan.role.landingPath) await operator.setRoleLandingPath(role.roleId, plan.role.landingPath);
      },
    },
    {
      // 계정은 전역이라 되돌리기 뒤에도 남는다 — 다시 돌리면 «있으면 소속 → 부여 → 비밀번호 재발급»으로 이어 간다.
      name: `점검 계정 ${plan.checkAccount.loginId} (비밀번호 변경 강제 없음)`,
      // 테넌트를 지우면 그 부여도 걷히므로, 되돌리기 뒤에는 구성원에서 빠져 이 단계가 다시 돈다.
      async isDone() {
        const members = await operator.roleMemberLoginIds(await roleId());
        return members.includes(plan.checkAccount.loginId) && (await ports.checkSecret.has());
      },
      async run() {
        const role = await roleId();
        const existing = await operator.findUserIdByLoginId(plan.checkAccount.loginId);
        if (!existing) {
          const made = await operator.createStaff({
            ...plan.checkAccount,
            roleId: role,
            tenantId: entry.id,
            forcePasswordChange: false,
          });
          await ports.checkSecret.save(plan.checkAccount.loginId, made.initialPassword);
          return;
        }
        await operator.addMember(entry.id, existing);
        await operator.addRoleMembers(role, entry.id, [existing]);
        const password = await operator.reissuePassword(entry.id, existing, false);
        await ports.checkSecret.save(plan.checkAccount.loginId, password);
      },
    },
    {
      // 준비하는 동안 남의 변경이 새 마이그를 실었을 수 있다 — 목록에 넣기 직전에 다시 맞춘다.
      name: `재마이그 + 테넌트 1(${ports.tenantOneCoreDb}) 과 버전 비교`,
      isDone: async () => (await migratedLikeTenantOne()).same,
      async run() {
        await dbs.migrate(db);
        const { mine, theirs, same } = await migratedLikeTenantOne();
        if (!same) {
          throw new Error(
            `마이그 버전이 테넌트 1 과 다르다 (${db} ${mine.length}개 · ${ports.tenantOneCoreDb} ${theirs.length}개) — 테넌트 1 을 먼저 마이그할 것`,
          );
        }
      },
    },
    {
      name: '테넌트 목록에 넣기',
      commitPoint: true,
      isDone: () => ports.list.lists(entry),
      run: () => ports.list.add(entry),
      undo: () => ports.list.remove(entry.id),
    },
    {
      name: ports.deployment.describe(),
      isDone: async () => (await tenantStatus()) === 'active' || (await dbs.cronRuns(db)).rows > 0,
      run: () => ports.deployment.run(entry),
    },
    {
      name: '만든 직후 확인 → «활성»',
      isDone: async () => (await tenantStatus()) === 'active',
      async run() {
        await verifyCreated(plan, ports);
        await operator.setTenantStatus(entry.id, 'active');
      },
    },
  ];
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** DB·마이그 버전 = 테넌트 1, 참조 시드 있음, 창고 0행, cron_runs 주기당 1행, 버킷 쓰기·읽기. 하나라도 틀리면 던진다. */
async function verifyCreated(plan: TenantPlan, ports: CreationPorts): Promise<void> {
  const { databases: dbs, buckets } = ports;
  const db = plan.entry.coreDb;
  const problems: string[] = [];

  if (!(await dbs.exists(db))) problems.push(`${db} 가 없다`);
  const [mine, theirs] = await Promise.all([dbs.appliedMigrations(db), dbs.appliedMigrations(ports.tenantOneCoreDb)]);
  if (!sameSet(mine, theirs)) {
    problems.push(`마이그 버전이 테넌트 1 과 다르다 (${mine.length} · ${theirs.length})`);
  }
  if (!(await dbs.allTenantsSeedDone(db))) problems.push('«모든 테넌트» 참조 시드가 비어 있다');
  const warehouses = await dbs.warehouseCount(db);
  if (warehouses !== 0) problems.push(`창고가 ${warehouses}행 있다 — 새 테넌트는 0행으로 태어나야 한다`);
  const cron = await dbs.cronRuns(db);
  if (cron.rows === 0) problems.push('cron_runs 가 비어 있다 — 크론이 이 테넌트 DB 에서 돌지 않는다');
  if (cron.duplicatedPeriods > 0) problems.push(`cron_runs 에 한 주기 두 행 이상이 ${cron.duplicatedPeriods}건`);
  for (const b of new Set([plan.entry.publicBucket, plan.entry.privateBucket])) {
    try {
      await buckets.probe(b);
    } catch (e) {
      problems.push(`버킷 ${b} 쓰기·읽기 실패: ${messageOf(e)}`);
    }
  }

  if (problems.length > 0) throw new Error(`만든 직후 확인 실패 — ${problems.join(' / ')}`);
}
