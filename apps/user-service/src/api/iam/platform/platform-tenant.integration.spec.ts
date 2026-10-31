import { DbService } from '@app/db';
import {
  iamAuditLogs,
  oauthClients,
  oauthTokens,
  tenantDomains,
  tenantMemberships,
  tenants,
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
import { BadRequestError, NotFoundError } from '@app/shared';
import * as bcrypt from 'bcrypt';
import {
  IamNotTenantMemberError,
  IamOperatorOnlyError,
  TenantDomainTakenError,
  TenantOwnSuspendError,
  TenantStatusConflictError,
} from '../iam.errors';
import { RoleRepository } from '../roles/role.repository';
import { ActorTenantReader } from '../tenancy/actor-tenant.reader';
import { PlatformOperatorManager } from '../tenancy/platform-operator.manager';
import { TenancyRepository } from '../tenancy/tenancy.repository';
import { PlatformRepository } from './platform.repository';
import { PlatformTenantManager } from './platform-tenant.manager';
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

  const makeUser = async (suffix: string, isPlatformOperator = false) => {
    const [row] = await dbService.db
      .insert(users)
      .values({
        loginId: `${PREFIX}${suffix}`,
        username: suffix,
        nickname: suffix,
        email: `${PREFIX}${suffix}@example.test`,
        isPlatformOperator,
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
    domains: [host],
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
    await dbService.db.delete(tenants).where(like(tenants.id, `${PREFIX}%`));
    await dbService.db.delete(users).where(like(users.loginId, `${PREFIX}%`));
  };

  beforeAll(() => {
    dbService = new DbService({ connectionString: DATABASE_URL ?? '' }, userServiceSchema);
    const tenancy = new TenancyRepository(dbService);
    const roleRepository = new RoleRepository(dbService);
    const audit = new IamAuditCreator(new IamAuditRepository(dbService));
    const platform = new PlatformRepository(dbService);
    brands = new TenantBrandReader(platform);
    manager = new PlatformTenantManager(
      dbService,
      platform,
      tenancy,
      roleRepository,
      new PlatformOperatorManager(dbService, tenancy, roleRepository, audit, new ActorTenantReader(tenancy)),
      new ActorTenantReader(tenancy),
      audit,
      new PublicClientOriginsCache(new PublicClientOriginsRepository(dbService)),
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
      expect(domains.map((d) => d.host)).toEqual([HOST]);
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
    it('deletes a preparing tenant with its domains and memberships, and strips its addresses from the staff client', async () => {
      const op = await makeUser('op', true);
      const staff = await makeUser('staff');
      await manager.createTenant(actor(op), newTenant());
      await manager.addMember(actor(op), TENANT, staff);
      const client = await makeClient('staff', null, ['http://localhost:8002/api/auth/callback']);
      await manager.addStaffClientUris(actor(op), TENANT, client, {
        redirectUris: [`https://${HOST}/api/auth/callback`],
        postLogoutRedirectUris: [`https://${HOST}/login`],
      });

      await manager.deleteTenant(actor(op), TENANT);

      expect(await statusOf(TENANT)).toBeUndefined();
      expect(await dbService.db.select().from(tenantDomains).where(eq(tenantDomains.tenantId, TENANT))).toEqual([]);
      expect(await dbService.db.select().from(tenantMemberships).where(eq(tenantMemberships.tenantId, TENANT))).toEqual(
        [],
      );
      expect(await urisOf(client)).toEqual({ redirect: ['http://localhost:8002/api/auth/callback'], logout: null });
      expect((await auditOf(TENANT)).map((l) => l.action)).toContain('tenant.delete');
    });

    it('refuses a tenant that has left «preparing»', async () => {
      const op = await makeUser('op', true);
      await manager.createTenant(actor(op), newTenant());
      await manager.setStatus(actor(op), TENANT, 'active');

      await expect(manager.deleteTenant(actor(op), TENANT)).rejects.toBeInstanceOf(TenantStatusConflictError);
      expect(await statusOf(TENANT)).toBe('active');
    });
  });

  describe('reissuing a staff password', () => {
    const passwordOf = async (userId: string) => {
      const [row] = await dbService.db
        .select({ hash: users.password, mustChange: users.mustChangePassword })
        .from(users)
        .where(eq(users.id, userId));
      return row;
    };

    it('gives a member a new initial password, forces a change, cuts their sessions and keeps the password out of the log', async () => {
      const op = await makeUser('op', true);
      const staff = await makeUser('staff');
      await manager.createTenant(actor(op), newTenant());
      await manager.addMember(actor(op), TENANT, staff);
      const session = await openSession(staff, await makeClient('client', null), TENANT);

      const { initialPassword } = await manager.reissuePassword(actor(op), TENANT, staff, true);

      const { hash, mustChange } = await passwordOf(staff);
      expect(await bcrypt.compare(initialPassword, hash ?? '')).toBe(true);
      expect(mustChange).toBe(true);
      expect(await isRevoked(session)).toBe(true);
      const [log] = (await auditOf(TENANT)).filter((l) => l.action === 'user.password.reissue');
      expect(log).toMatchObject({ targetType: 'user', targetId: staff });
      expect(JSON.stringify([log.before, log.after])).not.toContain(initialPassword);
    });

    it('can leave the change unforced (the read-only check account)', async () => {
      const op = await makeUser('op', true);
      const check = await makeUser('check');
      await manager.createTenant(actor(op), newTenant());
      await manager.addMember(actor(op), TENANT, check);

      await manager.reissuePassword(actor(op), TENANT, check, false);

      expect((await passwordOf(check)).mustChange).toBe(false);
    });

    it('refuses an account that is not a member of the tenant', async () => {
      const op = await makeUser('op', true);
      const stranger = await makeUser('stranger');
      await manager.createTenant(actor(op), newTenant());

      await expect(manager.reissuePassword(actor(op), TENANT, stranger, true)).rejects.toBeInstanceOf(
        IamNotTenantMemberError,
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
});
