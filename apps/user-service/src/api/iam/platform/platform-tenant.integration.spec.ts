import { DbService } from '@app/db';
import {
  iamAuditLogs,
  oauthClients,
  oauthTokens,
  tenantDomains,
  tenants,
  roles,
  userRoleAssignments,
  users,
  userServiceSchema,
  type UserServiceSchema,
} from 'apps/user-service/database/drizzle/schema';
import { and, eq, inArray, like, or } from 'drizzle-orm';
import { PublicClientOriginsCache } from '../../oauth/cors/public-client-origins.cache';
import { PublicClientOriginsRepository } from '../../oauth/cors/public-client-origins.repository';
import { IamAuditCreator } from '../audit/iam-audit.creator';
import { IamAuditRepository } from '../audit/iam-audit.repository';
import { SYSTEM_ROLE_NAME } from '../iam.constants';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import * as bcrypt from 'bcrypt';
import {
  IamNotAccountTenantError,
  IamOperatorOnlyError,
  TenantDomainTakenError,
  TenantHasMasterError,
  TenantOwnSuspendError,
  TenantStatusConflictError,
} from '../iam.errors';
import { GrantAuthority } from '../assignments/grant-authority';
import { RoleAssignmentManager } from '../assignments/role-assignment.manager';
import { IamRepository } from '../iam.repository';
import { MyPermissionsReader } from '../my-permissions.reader';
import { RolePermissionsReader } from '../role-permissions.reader';
import { RoleRepository } from '../roles/role.repository';
import { ActorTenantReader } from '../tenancy/actor-tenant.reader';
import { PlatformOperatorManager } from '../tenancy/platform-operator.manager';
import { TenancyRepository } from '../tenancy/tenancy.repository';
import { PlatformRepository } from './platform.repository';
import { PlatformTenantManager } from './platform-tenant.manager';
import { PlatformTenantReader } from './platform-tenant.reader';
import { TenantBrandReader } from './tenant-brand.reader';

const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_USER_SERVICE_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_USER_SERVICE_DB requires an explicit DATABASE_URL');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const PREFIX = 'zzp6';
const TENANT = `${PREFIX}t`;
const HOST = `${PREFIX}.admin.example.test`;

describeIfDb('platform operator tenant API against a real database', () => {
  let dbService: DbService<UserServiceSchema>;
  let manager: PlatformTenantManager;
  let brands: TenantBrandReader;
  let reader: PlatformTenantReader;

  // 테넌트를 주지 않으면 테넌트 1 의 계정이다 — DB 기본값은 없다.
  const makeUser = async (suffix: string, isPlatformOperator = false, tenantId = '1') => {
    const [row] = await dbService.db
      .insert(users)
      .values({
        loginId: `${PREFIX}${suffix}`,
        username: suffix,
        nickname: suffix,
        email: `${PREFIX}${suffix}@example.test`,
        isPlatformOperator,
        tenantId,
      })
      .returning({ id: users.id });
    return row.id;
  };
  const actor = (userId: string) => ({
    userId,
    loginId: `${PREFIX}actor`,
    roles: [SYSTEM_ROLE_NAME],
    userAgent: null,
    requestId: null,
    ip: null,
    tenantId: '1',
  });
  const newTenant = (id = TENANT, host = HOST) => ({
    id,
    slug: id.replace(/[^a-z0-9]/g, ''),
    displayName: `브랜드 ${id}`,
    logoUrl: `https://cdn.example.test/${id}.png`,
    domains: [{ host, app: 'admin-web' as const }],
  });
  const makeClient = async (clientId: string, tenantId: string | null, redirectUris: string[] = []) => {
    await dbService.db
      .insert(oauthClients)
      .values({ clientId: `${PREFIX}${clientId}`, clientSecretHash: 'x', redirectUris, tenantId });
    return `${PREFIX}${clientId}`;
  };
  const openSession = async (userId: string, clientId: string, tenantId: string | null) => {
    const [row] = await dbService.db
      .insert(oauthTokens)
      .values({
        userId,
        clientId,
        tenantId,
        refreshToken: `${PREFIX}-${Math.random()}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      })
      .returning({ id: oauthTokens.id });
    return row.id;
  };
  const isRevoked = async (tokenId: string) => {
    const [row] = await dbService.db
      .select({ revoked: oauthTokens.isRevoked })
      .from(oauthTokens)
      .where(eq(oauthTokens.id, tokenId));
    return row.revoked;
  };
  const urisOf = async (clientId: string) => {
    const [row] = await dbService.db
      .select({ redirect: oauthClients.redirectUris, logout: oauthClients.postLogoutRedirectUris })
      .from(oauthClients)
      .where(eq(oauthClients.clientId, clientId));
    return row;
  };
  const statusOf = async (tenantId: string) => {
    const [row] = await dbService.db.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId));
    return row?.status;
  };
  const auditOf = (tenantId: string) =>
    dbService.db
      .select()
      .from(iamAuditLogs)
      .where(eq(iamAuditLogs.tenantId, tenantId))
      .orderBy(iamAuditLogs.occurredAt);

  const masterRoleId = async () => {
    const [row] = await dbService.db.select({ id: roles.roleId }).from(roles).where(eq(roles.name, SYSTEM_ROLE_NAME));
    if (row) return row.id;
    const [made] = await dbService.db.insert(roles).values({ name: SYSTEM_ROLE_NAME }).returning({ id: roles.roleId });
    return made.id;
  };
  /** 운영자 — 운영자 성질 + 테넌트 1 master(권한 상승 방지: master 를 주려면 master 의 권한을 다 가져야 한다). */
  const makeOperator = async (suffix = 'op') => {
    const id = await makeUser(suffix, true);
    await dbService.db.insert(userRoleAssignments).values({ userId: id, roleId: await masterRoleId(), tenantId: '1' });
    return id;
  };
  const grantsOf = (userId: string) =>
    dbService.db
      .select({ name: roles.name, tenantId: userRoleAssignments.tenantId })
      .from(userRoleAssignments)
      .innerJoin(roles, eq(roles.roleId, userRoleAssignments.roleId))
      .where(eq(userRoleAssignments.userId, userId));
  const accountOf = async (userId: string) => {
    const [row] = await dbService.db.select().from(users).where(eq(users.id, userId));
    return row;
  };
  const bossInput = (suffix = 'boss') => ({
    loginId: `${PREFIX}${suffix}`,
    username: '대표',
    nickname: '대표',
    email: `${PREFIX}${suffix}@example.test`,
  });

  const cleanup = async () => {
    const ids = (
      await dbService.db
        .select({ id: users.id })
        .from(users)
        .where(like(users.loginId, `${PREFIX}%`))
    ).map((u) => u.id);
    await dbService.db
      .delete(iamAuditLogs)
      .where(
        or(
          like(iamAuditLogs.tenantId, `${PREFIX}%`),
          like(iamAuditLogs.targetId, `${PREFIX}%`),
          ids.length > 0 ? inArray(iamAuditLogs.targetId, ids) : undefined,
        ),
      );
    await dbService.db.delete(oauthTokens).where(like(oauthTokens.clientId, `${PREFIX}%`));
    await dbService.db.delete(oauthClients).where(like(oauthClients.clientId, `${PREFIX}%`));
    // 계정이 테넌트를 가리키므로(ADR-0056) 계정을 먼저 지운다.
    await dbService.db.delete(users).where(like(users.loginId, `${PREFIX}%`));
    await dbService.db.delete(roles).where(like(roles.name, `${PREFIX}%`));
    await dbService.db.delete(tenants).where(like(tenants.id, `${PREFIX}%`));
  };

  beforeAll(() => {
    dbService = new DbService({ connectionString: DATABASE_URL ?? '' }, userServiceSchema);
    const tenancy = new TenancyRepository(dbService);
    const roleRepository = new RoleRepository(dbService);
    const audit = new IamAuditCreator(new IamAuditRepository(dbService));
    const platform = new PlatformRepository(dbService);
    const iam = new IamRepository(dbService);
    const snapshots = new RolePermissionsReader(iam);
    const operators = new PlatformOperatorManager(
      dbService,
      tenancy,
      roleRepository,
      audit,
      new ActorTenantReader(tenancy),
    );
    brands = new TenantBrandReader(platform);
    reader = new PlatformTenantReader(dbService, platform, operators);
    manager = new PlatformTenantManager(
      dbService,
      platform,
      roleRepository,
      operators,
      new ActorTenantReader(tenancy),
      audit,
      new PublicClientOriginsCache(new PublicClientOriginsRepository(dbService)),
      new RoleAssignmentManager(
        dbService,
        roleRepository,
        audit,
        new GrantAuthority(roleRepository, new MyPermissionsReader(snapshots, iam), snapshots),
        operators,
      ),
    );
  });
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await dbService.onApplicationShutdown();
  });

  describe('creating a tenant', () => {
    it('creates it in «preparing» with its domains and records the tenant in the change log', async () => {
      const op = await makeUser('op', true);

      await manager.createTenant(actor(op), newTenant());

      const [row] = await dbService.db.select().from(tenants).where(eq(tenants.id, TENANT));
      expect(row).toMatchObject({ status: 'preparing', displayName: `브랜드 ${TENANT}` });
      const domains = await dbService.db.select().from(tenantDomains).where(eq(tenantDomains.tenantId, TENANT));
      expect(domains.map((d) => ({ host: d.host, app: d.app }))).toEqual([{ host: HOST, app: 'admin-web' }]);
      const [log] = await auditOf(TENANT);
      expect(log).toMatchObject({ action: 'tenant.create', targetType: 'tenant', targetId: TENANT });
    });

    it('refuses an account that is not a platform operator, even with the system role', async () => {
      const notOp = await makeUser('notop');

      await expect(manager.createTenant(actor(notOp), newTenant())).rejects.toBeInstanceOf(IamOperatorOnlyError);
      expect(await dbService.db.select().from(tenants).where(eq(tenants.id, TENANT))).toEqual([]);
    });

    it('refuses a domain that already belongs to a tenant', async () => {
      const op = await makeUser('op', true);
      await manager.createTenant(actor(op), newTenant());

      await expect(manager.createTenant(actor(op), newTenant(`${TENANT}2`, HOST))).rejects.toBeInstanceOf(
        TenantDomainTakenError,
      );
      expect(
        await dbService.db
          .select()
          .from(tenants)
          .where(eq(tenants.id, `${TENANT}2`)),
      ).toEqual([]);
    });
  });

  describe('changing a tenant status', () => {
    it('goes preparing → active → suspended → active, logging each change under the tenant', async () => {
      const op = await makeUser('op', true);
      await manager.createTenant(actor(op), newTenant());

      await manager.setStatus(actor(op), TENANT, 'active');
      await manager.setStatus(actor(op), TENANT, 'suspended');
      await manager.setStatus(actor(op), TENANT, 'active');

      expect(await statusOf(TENANT)).toBe('active');
      const changes = (await auditOf(TENANT)).filter((l) => l.action === 'tenant.status.set');
      expect(changes.map((l) => [l.before, l.after])).toEqual([
        [{ status: 'preparing' }, { status: 'active' }],
        [{ status: 'active' }, { status: 'suspended', revokedSessions: 0 }],
        [{ status: 'suspended' }, { status: 'active' }],
      ]);
    });

    it('refuses to suspend a tenant that never became active, and to go back to preparing', async () => {
      const op = await makeUser('op', true);
      await manager.createTenant(actor(op), newTenant());

      await expect(manager.setStatus(actor(op), TENANT, 'suspended')).rejects.toBeInstanceOf(TenantStatusConflictError);
      await manager.setStatus(actor(op), TENANT, 'active');
      await expect(manager.setStatus(actor(op), TENANT, 'preparing')).rejects.toBeInstanceOf(TenantStatusConflictError);
    });

    it("cuts that tenant's sessions when suspending, and leaves other tenants' sessions alone", async () => {
      const op = await makeUser('op', true);
      const staff = await makeUser('staff');
      await manager.createTenant(actor(op), newTenant());
      await manager.setStatus(actor(op), TENANT, 'active');
      const client = await makeClient('client', null);
      const mine = await openSession(staff, client, TENANT);
      const other = await openSession(staff, client, '1');

      await manager.setStatus(actor(op), TENANT, 'suspended');

      expect(await isRevoked(mine)).toBe(true);
      expect(await isRevoked(other)).toBe(false);
    });

    it('refuses to suspend the tenant the operator is working in', async () => {
      const op = await makeUser('op', true);
      await manager.createTenant(actor(op), newTenant());
      await manager.setStatus(actor(op), TENANT, 'active');

      await expect(manager.setStatus({ ...actor(op), tenantId: TENANT }, TENANT, 'suspended')).rejects.toBeInstanceOf(
        TenantOwnSuspendError,
      );
      expect(await statusOf(TENANT)).toBe('active');
    });
  });

  describe('registering tenant-domain addresses on the staff web client', () => {
    const TENANT_ONE_URI = 'http://localhost:8002/api/auth/callback';
    const redirect = `https://${HOST}/api/auth/callback`;
    const logout = `https://${HOST}/login`;

    it('adds redirect and logout addresses on the tenant domain, keeping what was there, once', async () => {
      const op = await makeUser('op', true);
      await manager.createTenant(actor(op), newTenant());
      const client = await makeClient('staff', null, [TENANT_ONE_URI]);

      await manager.addStaffClientUris(actor(op), TENANT, client, {
        redirectUris: [redirect],
        postLogoutRedirectUris: [logout],
      });
      await manager.addStaffClientUris(actor(op), TENANT, client, {
        redirectUris: [redirect],
        postLogoutRedirectUris: [logout],
      });

      expect(await urisOf(client)).toEqual({ redirect: [TENANT_ONE_URI, redirect], logout: [logout] });
      const logs = (await auditOf(TENANT)).filter((l) => l.action === 'tenant.oauth_redirects.add');
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ targetType: 'oauth_client', targetId: client });
    });

    it("refuses an address that is not on this tenant's domains", async () => {
      const op = await makeUser('op', true);
      await manager.createTenant(actor(op), newTenant());
      const client = await makeClient('staff', null, [TENANT_ONE_URI]);

      await expect(
        manager.addStaffClientUris(actor(op), TENANT, client, {
          redirectUris: ['https://elsewhere.example.test/api/auth/callback'],
          postLogoutRedirectUris: [],
        }),
      ).rejects.toBeInstanceOf(BadRequestError);
      expect((await urisOf(client)).redirect).toEqual([TENANT_ONE_URI]);
    });

    it('refuses a client that belongs to a fixed tenant (a storefront)', async () => {
      const op = await makeUser('op', true);
      await manager.createTenant(actor(op), newTenant());
      const client = await makeClient('shop', '1');

      await expect(
        manager.addStaffClientUris(actor(op), TENANT, client, { redirectUris: [redirect], postLogoutRedirectUris: [] }),
      ).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  describe('deleting a tenant (undoing the create script)', () => {
    it('deletes a preparing tenant with its domains, and strips its addresses from the staff client', async () => {
      const op = await makeUser('op', true);
      await manager.createTenant(actor(op), newTenant());
      const client = await makeClient('staff', null, ['http://localhost:8002/api/auth/callback']);
      await manager.addStaffClientUris(actor(op), TENANT, client, {
        redirectUris: [`https://${HOST}/api/auth/callback`],
        postLogoutRedirectUris: [`https://${HOST}/login`],
      });

      await manager.deleteTenant(actor(op), TENANT);

      expect(await statusOf(TENANT)).toBeUndefined();
      expect(await dbService.db.select().from(tenantDomains).where(eq(tenantDomains.tenantId, TENANT))).toEqual([]);
      expect(await urisOf(client)).toEqual({ redirect: ['http://localhost:8002/api/auth/callback'], logout: null });
      expect((await auditOf(TENANT)).map((l) => l.action)).toContain('tenant.delete');
    });

    it('refuses a tenant that already has an account (its first master) — an account belongs to its tenant', async () => {
      const op = await makeOperator();
      await manager.createTenant(actor(op), newTenant());
      await manager.createFirstMaster(actor(op), TENANT, bossInput());

      await expect(manager.deleteTenant(actor(op), TENANT)).rejects.toBeInstanceOf(TenantStatusConflictError);
      expect(await statusOf(TENANT)).toBe('preparing');
    });

    it('refuses a tenant that has left «preparing»', async () => {
      const op = await makeUser('op', true);
      await manager.createTenant(actor(op), newTenant());
      await manager.setStatus(actor(op), TENANT, 'active');

      await expect(manager.deleteTenant(actor(op), TENANT)).rejects.toBeInstanceOf(TenantStatusConflictError);
      expect(await statusOf(TENANT)).toBe('active');
    });
  });

  describe("making a tenant's first master (one of the two cross-tenant jobs)", () => {
    it('creates an account of that tenant holding master, returns the password once with a change forced, and logs it under the tenant', async () => {
      const op = await makeOperator();
      await manager.createTenant(actor(op), newTenant());

      const made = await manager.createFirstMaster(actor(op), TENANT, bossInput());

      const account = await accountOf(made.userId);
      expect(account).toMatchObject({ tenantId: TENANT, loginId: `${PREFIX}boss`, mustChangePassword: true });
      expect(await bcrypt.compare(made.initialPassword, account.password ?? '')).toBe(true);
      expect(await grantsOf(made.userId)).toEqual([{ name: SYSTEM_ROLE_NAME, tenantId: TENANT }]);
      const logs = (await auditOf(TENANT)).filter((l) => l.targetId === made.userId);
      expect(logs.map((l) => l.action)).toEqual(['admin_user.create']);
      expect(JSON.stringify(logs)).not.toContain(made.initialPassword);
    });

    it('can leave the change unforced — our check account, whose password lives in a secret', async () => {
      const op = await makeOperator();
      await manager.createTenant(actor(op), newTenant());

      const made = await manager.createFirstMaster(actor(op), TENANT, { ...bossInput('check'), forcePasswordChange: false });

      expect((await accountOf(made.userId)).mustChangePassword).toBe(false);
    });

    it('makes an account already in that tenant its first master with a new password, keeping its other roles and cutting its sessions', async () => {
      const op = await makeOperator();
      await manager.createTenant(actor(op), newTenant());
      const before = await makeUser('check', false, TENANT);
      const [staffRole] = await dbService.db
        .insert(roles)
        .values({ name: `${PREFIX}_staff` })
        .returning({ id: roles.roleId });
      await dbService.db.insert(userRoleAssignments).values({ userId: before, roleId: staffRole.id, tenantId: TENANT });
      const session = await openSession(before, await makeClient('client', null), TENANT);

      const made = await manager.createFirstMaster(actor(op), TENANT, bossInput('check'));

      expect(made.userId).toBe(before);
      expect(await bcrypt.compare(made.initialPassword, (await accountOf(before)).password ?? '')).toBe(true);
      expect((await grantsOf(before)).map((g) => g.name)).toEqual(
        expect.arrayContaining([SYSTEM_ROLE_NAME, `${PREFIX}_staff`]),
      );
      expect(await isRevoked(session)).toBe(true);
      expect((await auditOf(TENANT)).map((l) => l.action)).toEqual(
        expect.arrayContaining(['role.members.add', 'user.password.reissue']),
      );
    });

    it('does not take over a withdrawn or dormant account of that tenant — it is refused like a taken login id', async () => {
      const op = await makeOperator();
      await manager.createTenant(actor(op), newTenant());
      const gone = await makeUser('gone', false, TENANT);
      await dbService.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, gone));

      await expect(manager.createFirstMaster(actor(op), TENANT, bossInput('gone'))).rejects.toBeInstanceOf(ConflictError);
      expect(await grantsOf(gone)).toEqual([]);
    });

    it('refuses once the tenant has a master — after that its master manages its staff', async () => {
      const op = await makeOperator();
      await manager.createTenant(actor(op), newTenant());
      await manager.createFirstMaster(actor(op), TENANT, bossInput());

      await expect(manager.createFirstMaster(actor(op), TENANT, bossInput('second'))).rejects.toBeInstanceOf(
        TenantHasMasterError,
      );
      await expect(manager.createFirstMaster(actor(op), TENANT, bossInput())).rejects.toBeInstanceOf(
        TenantHasMasterError,
      );
    });

    it('refuses a login id or e-mail an account of that tenant already uses, and a non-operator', async () => {
      const op = await makeOperator();
      await manager.createTenant(actor(op), newTenant());
      await makeUser('taken', false, TENANT);

      await expect(
        manager.createFirstMaster(actor(op), TENANT, { ...bossInput(), email: `${PREFIX}taken@example.test` }),
      ).rejects.toBeInstanceOf(ConflictError);
      await expect(manager.createFirstMaster(actor(await makeUser('notop')), TENANT, bossInput())).rejects.toBeInstanceOf(
        IamOperatorOnlyError,
      );
      expect(await reader.masters(actor(op), TENANT)).toEqual([]);
    });

    it("lists that tenant's masters for the create script, and refuses a non-operator", async () => {
      const op = await makeOperator();
      await manager.createTenant(actor(op), newTenant());
      const made = await manager.createFirstMaster(actor(op), TENANT, bossInput());

      expect(await reader.masters(actor(op), TENANT)).toEqual([{ userId: made.userId, loginId: `${PREFIX}boss` }]);
      await expect(reader.masters(actor(await makeUser('notop')), TENANT)).rejects.toBeInstanceOf(
        IamOperatorOnlyError,
      );
    });
  });

  describe("resetting a tenant master's password (the other cross-tenant job)", () => {
    it('gives the master a new password, forces a change, cuts their sessions and keeps the password out of the log', async () => {
      const op = await makeOperator();
      await manager.createTenant(actor(op), newTenant());
      const { userId } = await manager.createFirstMaster(actor(op), TENANT, bossInput());
      const session = await openSession(userId, await makeClient('client', null), TENANT);

      const { initialPassword } = await manager.resetMasterPassword(actor(op), TENANT, userId);

      const account = await accountOf(userId);
      expect(await bcrypt.compare(initialPassword, account.password ?? '')).toBe(true);
      expect(account.mustChangePassword).toBe(true);
      expect(await isRevoked(session)).toBe(true);
      const [log] = (await auditOf(TENANT)).filter((l) => l.action === 'user.password.reissue');
      expect(log).toMatchObject({ targetType: 'user', targetId: userId });
      expect(JSON.stringify([log.before, log.after])).not.toContain(initialPassword);
    });

    it('can leave the change unforced (our check account)', async () => {
      const op = await makeOperator();
      await manager.createTenant(actor(op), newTenant());
      const { userId } = await manager.createFirstMaster(actor(op), TENANT, bossInput());

      await manager.resetMasterPassword(actor(op), TENANT, userId, false);

      expect((await accountOf(userId)).mustChangePassword).toBe(false);
    });

    it('refuses an account of that tenant that is not its master — its master resets staff passwords', async () => {
      const op = await makeOperator();
      await manager.createTenant(actor(op), newTenant());
      const staff = await makeUser('staff', false, TENANT);

      await expect(manager.resetMasterPassword(actor(op), TENANT, staff)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('refuses an account of another tenant', async () => {
      const op = await makeOperator();
      const stranger = await makeUser('stranger');
      await manager.createTenant(actor(op), newTenant());

      await expect(manager.resetMasterPassword(actor(op), TENANT, stranger)).rejects.toBeInstanceOf(
        IamNotAccountTenantError,
      );
    });
  });

  describe('brand lookup by address (no token)', () => {
    it('answers only the name, the logo and whether the tenant is active', async () => {
      const op = await makeUser('op', true);
      await manager.createTenant(actor(op), newTenant());

      expect(await brands.byHost(HOST)).toEqual({
        displayName: `브랜드 ${TENANT}`,
        logoUrl: `https://cdn.example.test/${TENANT}.png`,
        active: false,
      });
      await manager.setStatus(actor(op), TENANT, 'active');
      expect(await brands.byHost(HOST.toUpperCase())).toMatchObject({ active: true });
    });

    it('does not know an address that is not a tenant domain', async () => {
      await expect(brands.byHost(`unknown.${HOST}`)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('adding a domain to an existing tenant (the auth-web address)', () => {
    it('adds it once to an active tenant and logs it under the tenant — running it again changes nothing', async () => {
      const op = await makeUser('op', true);
      await manager.createTenant(actor(op), newTenant());
      await manager.setStatus(actor(op), TENANT, 'active');

      await manager.addDomain(actor(op), TENANT, { host: `AUTH.${HOST}`, app: 'auth-web' });
      await manager.addDomain(actor(op), TENANT, { host: `auth.${HOST}`, app: 'auth-web' });

      const domains = await dbService.db.select().from(tenantDomains).where(eq(tenantDomains.tenantId, TENANT));
      expect(domains.map((d) => [d.host, d.app]).sort()).toEqual([
        [`auth.${HOST}`, 'auth-web'],
        [HOST, 'admin-web'],
      ]);
      const logs = (await auditOf(TENANT)).filter((l) => l.action === 'tenant.domain.add');
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ targetType: 'tenant', targetId: TENANT, after: { host: `auth.${HOST}` } });
    });

    it("refuses another tenant's domain", async () => {
      const op = await makeUser('op', true);
      await manager.createTenant(actor(op), newTenant());
      await manager.createTenant(actor(op), newTenant(`${TENANT}2`, `other.${HOST}`));

      await expect(manager.addDomain(actor(op), `${TENANT}2`, { host: HOST, app: 'admin-web' })).rejects.toBeInstanceOf(
        TenantDomainTakenError,
      );
    });

    it('refuses changing the app of its own domain', async () => {
      const op = await makeUser('op', true);
      await manager.createTenant(actor(op), newTenant());

      await expect(manager.addDomain(actor(op), TENANT, { host: HOST, app: 'auth-web' })).rejects.toBeInstanceOf(
        TenantDomainTakenError,
      );
    });

    it('refuses a non-operator and an unknown tenant', async () => {
      const op = await makeUser('op', true);
      const notOp = await makeUser('notop');
      await manager.createTenant(actor(op), newTenant());

      const auth = { host: `auth.${HOST}`, app: 'auth-web' as const };
      await expect(manager.addDomain(actor(notOp), TENANT, auth)).rejects.toBeInstanceOf(IamOperatorOnlyError);
      await expect(manager.addDomain(actor(op), `${TENANT}x`, auth)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('site lookup by address (auth-web server, internal secret)', () => {
    it("answers the tenant, its brand and every domain of that tenant — auth-web keeps redirects inside them", async () => {
      const op = await makeUser('op', true);
      await manager.createTenant(actor(op), {
        ...newTenant(),
        domains: [
          { host: HOST, app: 'admin-web' },
          { host: `auth.${HOST}`, app: 'auth-web' },
        ],
      });

      const site = await brands.siteByHost(`AUTH.${HOST}`);

      expect({ ...site, hosts: [...site.hosts].sort() }).toEqual({
        tenantId: TENANT,
        displayName: `브랜드 ${TENANT}`,
        logoUrl: `https://cdn.example.test/${TENANT}.png`,
        active: false,
        hosts: [`auth.${HOST}`, HOST],
      });
    });

    it('does not know an address that is not a tenant domain', async () => {
      await expect(brands.siteByHost(`unknown.${HOST}`)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('admin-web site lookup by address (admin-web server, its OIDC client credentials)', () => {
    it("answers the tenant, its brand and that tenant's auth-web address — the tenant shell sends sign-in there", async () => {
      const op = await makeUser('op', true);
      await manager.createTenant(actor(op), {
        ...newTenant(),
        domains: [
          { host: HOST, app: 'admin-web' },
          { host: `auth.${HOST}`, app: 'auth-web' },
        ],
      });

      expect(await brands.adminSiteByHost(HOST.toUpperCase())).toEqual({
        tenantId: TENANT,
        displayName: `브랜드 ${TENANT}`,
        logoUrl: `https://cdn.example.test/${TENANT}.png`,
        active: false,
        authHost: `auth.${HOST}`,
      });
    });

    it('answers no auth-web address when the tenant has none', async () => {
      const op = await makeUser('op', true);
      await manager.createTenant(actor(op), newTenant());

      expect(await brands.adminSiteByHost(HOST)).toMatchObject({ tenantId: TENANT, authHost: null });
    });

    it('does not know an auth-web address or an unknown address', async () => {
      const op = await makeUser('op', true);
      await manager.createTenant(actor(op), {
        ...newTenant(),
        domains: [
          { host: HOST, app: 'admin-web' },
          { host: `auth.${HOST}`, app: 'auth-web' },
        ],
      });

      await expect(brands.adminSiteByHost(`auth.${HOST}`)).rejects.toBeInstanceOf(NotFoundError);
      await expect(brands.adminSiteByHost(`unknown.${HOST}`)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
