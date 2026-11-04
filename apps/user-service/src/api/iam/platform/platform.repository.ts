import { DbService, InjectDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import {
  oauthClients,
  oauthTokens,
  roles,
  tenantDomains,
  tenants,
  tokens,
  userRoleAssignments,
  users,
  type TenantDomainApp,
  type UserServiceSchema,
  type UserServiceTx,
} from 'apps/user-service/database/drizzle/schema';
import { and, count, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { SYSTEM_ROLE_NAME } from '../iam.constants';

export type TenantStatus = (typeof tenants.$inferSelect)['status'];

export interface TenantDomainEntry {
  readonly host: string;
  /** 앱 칸 전에 들어온 행은 null 이다. */
  readonly app: TenantDomainApp | null;
}

export interface ClientUris {
  readonly clientId: string;
  readonly tenantId: string | null;
  readonly redirectUris: string[];
  readonly postLogoutRedirectUris: string[] | null;
}

const clientUris = {
  clientId: oauthClients.clientId,
  tenantId: oauthClients.tenantId,
  redirectUris: oauthClients.redirectUris,
  postLogoutRedirectUris: oauthClients.postLogoutRedirectUris,
};

export interface TenantRow {
  readonly id: string;
  readonly slug: string;
  readonly status: TenantStatus;
  readonly displayName: string;
  readonly logoUrl: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** 테넌트 행·테넌트 도메인. 바꾸는 쪽은 `PlatformTenantManager` 뿐이다. */
@Injectable()
export class PlatformRepository {
  constructor(@InjectDb() private readonly dbService: DbService<UserServiceSchema>) {}

  private client(tx?: UserServiceTx) {
    return tx ?? this.dbService.db;
  }

  async listTenants(): Promise<TenantRow[]> {
    return this.dbService.db.select().from(tenants).orderBy(tenants.createdAt);
  }

  async findTenant(tenantId: string, tx?: UserServiceTx): Promise<TenantRow | null> {
    const [row] = await this.client(tx).select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    return row ?? null;
  }

  /** 상태 전환·삭제는 행을 잠근 뒤 판정한다 — 동시 전환이 서로의 판정을 못 보는 일이 없게. */
  async lockTenant(tenantId: string, tx: UserServiceTx): Promise<TenantRow | null> {
    const [row] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).for('update');
    return row ?? null;
  }

  async findTenantBySlug(slug: string, tx: UserServiceTx): Promise<TenantRow | null> {
    const [row] = await tx.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
    return row ?? null;
  }

  async insertTenant(
    row: { id: string; slug: string; displayName: string; logoUrl: string | null },
    tx: UserServiceTx,
  ): Promise<TenantRow> {
    const [created] = await tx
      .insert(tenants)
      .values({ ...row, status: 'preparing' })
      .returning();
    return created;
  }

  async setStatus(tenantId: string, status: TenantStatus, tx: UserServiceTx): Promise<void> {
    await tx.update(tenants).set({ status, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
  }

  /** 부여·세션·도메인은 FK cascade 로 함께 지워진다. */
  async deleteTenant(tenantId: string, tx: UserServiceTx): Promise<void> {
    await tx.delete(tenants).where(eq(tenants.id, tenantId));
  }

  // ── 세션

  /** 이 테넌트로 나간 OAuth 세션을 끊는다(갱신이 안 된다). 끊은 수를 돌려준다. */
  async revokeTenantSessions(tenantId: string, tx: UserServiceTx): Promise<number> {
    const rows = await tx
      .update(oauthTokens)
      .set({ isRevoked: true, updatedAt: new Date() })
      .where(and(eq(oauthTokens.tenantId, tenantId), eq(oauthTokens.isRevoked, false)))
      .returning({ id: oauthTokens.id });
    return rows.length;
  }

  /** 이 계정의 모든 세션(OAuth·옛 내부 갱신 토큰)을 끊는다 — 비밀번호를 새로 정했을 때. */
  async revokeUserSessions(userId: string, tx: UserServiceTx): Promise<void> {
    await tx
      .update(oauthTokens)
      .set({ isRevoked: true, updatedAt: new Date() })
      .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.isRevoked, false)));
    await tx.delete(tokens).where(and(eq(tokens.userId, userId), eq(tokens.type, 'refresh')));
  }

  // ── 그 테넌트의 계정 — 운영자가 다른 테넌트 계정에 닿는 두 일(첫 master 만들기·master 비번 비상 초기화)만 쓴다

  /** 그 테넌트에서 지금 `master` 부여가 유효한 계정(탈퇴 제외) — 계정의 테넌트와 부여의 테넌트가 둘 다 그 테넌트인 것. */
  async mastersOf(tenantId: string, tx?: UserServiceTx): Promise<{ userId: string; loginId: string }[]> {
    return this.client(tx)
      .select({ userId: users.id, loginId: users.loginId })
      .from(userRoleAssignments)
      .innerJoin(roles, eq(roles.roleId, userRoleAssignments.roleId))
      .innerJoin(users, eq(users.id, userRoleAssignments.userId))
      .where(
        and(
          eq(roles.name, SYSTEM_ROLE_NAME),
          eq(userRoleAssignments.tenantId, tenantId),
          eq(users.tenantId, tenantId),
          isNull(users.deletedAt),
          or(isNull(userRoleAssignments.expiresAt), gt(userRoleAssignments.expiresAt, new Date())),
        ),
      )
      .orderBy(users.loginId);
  }

  /** 그 테넌트에서 로그인할 수 있는 계정(탈퇴·휴면 제외) — 탈퇴·휴면 계정의 값은 insert 의 unique 가 409 로 막는다. */
  async findAccountInTenant(
    tenantId: string,
    by: { loginId: string } | { email: string },
    tx: UserServiceTx,
  ): Promise<{ id: string } | null> {
    const match = 'loginId' in by ? eq(users.loginId, by.loginId) : eq(users.email, by.email);
    const [row] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), match, isNull(users.deletedAt), isNull(users.dormantAt)))
      .limit(1);
    return row ?? null;
  }

  async countAccountsOf(tenantId: string, tx: UserServiceTx): Promise<number> {
    const [row] = await tx.select({ n: count() }).from(users).where(eq(users.tenantId, tenantId));
    return Number(row?.n ?? 0);
  }

  /** 직원 계정 행 — 고객 가입이 아니라 이메일 인증을 묻지 않는다(관리자가 만드는 계정과 같다). */
  async insertStaffAccount(
    account: {
      tenantId: string;
      loginId: string;
      username: string;
      nickname: string;
      email: string;
      passwordHash: string;
      mustChangePassword: boolean;
    },
    tx: UserServiceTx,
  ): Promise<{ id: string }> {
    const [row] = await tx
      .insert(users)
      .values({
        tenantId: account.tenantId,
        loginId: account.loginId,
        username: account.username,
        nickname: account.nickname,
        email: account.email,
        password: account.passwordHash,
        mustChangePassword: account.mustChangePassword,
        isEmailVerified: true,
      })
      .returning({ id: users.id });
    return row;
  }

  async setPassword(userId: string, hash: string, mustChangePassword: boolean, tx: UserServiceTx): Promise<void> {
    await tx
      .update(users)
      .set({ password: hash, mustChangePassword, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  // ── 도메인

  async domainsOf(tenantId: string, tx?: UserServiceTx): Promise<string[]> {
    const rows = await this.client(tx)
      .select({ host: tenantDomains.host })
      .from(tenantDomains)
      .where(eq(tenantDomains.tenantId, tenantId))
      .orderBy(tenantDomains.host);
    return rows.map((r) => r.host);
  }

  /** 도메인과 그 앱 — 앱이 빈 행은 앱 칸 전에 들어온 행이다. */
  async domainEntriesOf(tenantId: string, tx?: UserServiceTx): Promise<TenantDomainEntry[]> {
    return this.client(tx)
      .select({ host: tenantDomains.host, app: tenantDomains.app })
      .from(tenantDomains)
      .where(eq(tenantDomains.tenantId, tenantId))
      .orderBy(tenantDomains.host);
  }

  async domainsOfAll(): Promise<{ host: string; tenantId: string; app: TenantDomainApp | null }[]> {
    return this.dbService.db
      .select({ host: tenantDomains.host, tenantId: tenantDomains.tenantId, app: tenantDomains.app })
      .from(tenantDomains)
      .orderBy(tenantDomains.host);
  }

  /** 주어진 host 중 이미 어느 테넌트의 도메인인 것. */
  async takenHosts(hosts: readonly string[], tx: UserServiceTx): Promise<string[]> {
    if (hosts.length === 0) return [];
    const rows = await tx
      .select({ host: tenantDomains.host })
      .from(tenantDomains)
      .where(inArray(tenantDomains.host, [...hosts]));
    return rows.map((r) => r.host);
  }

  async insertDomains(
    tenantId: string,
    domains: readonly { host: string; app: TenantDomainApp }[],
    tx: UserServiceTx,
  ): Promise<void> {
    if (domains.length === 0) return;
    await tx.insert(tenantDomains).values(domains.map(({ host, app }) => ({ host, app, tenantId })));
  }

  async setDomainApp(host: string, app: TenantDomainApp, tx: UserServiceTx): Promise<void> {
    await tx.update(tenantDomains).set({ app }).where(eq(tenantDomains.host, host));
  }

  // ── 브랜드(비인증 조회)

  async findBrandByHost(host: string): Promise<{
    tenantId: string;
    displayName: string;
    logoUrl: string | null;
    status: TenantStatus;
    app: TenantDomainApp | null;
  } | null> {
    const [row] = await this.dbService.db
      .select({
        tenantId: tenants.id,
        displayName: tenants.displayName,
        logoUrl: tenants.logoUrl,
        status: tenants.status,
        app: tenantDomains.app,
      })
      .from(tenantDomains)
      .innerJoin(tenants, eq(tenants.id, tenantDomains.tenantId))
      .where(eq(tenantDomains.host, host))
      .limit(1);
    return row ?? null;
  }

  // ── OAuth 클라이언트

  /** 활성 클라이언트의 비밀 해시 — 직원 웹 클라이언트 자격 판정(`StaffWebClientGuard`)용. */
  async findActiveClientSecrets(clientId: string): Promise<{
    clientType: (typeof oauthClients.$inferSelect)['clientType'];
    tenantId: string | null;
    clientSecretHash: string;
    previousSecretHash: string | null;
  } | null> {
    const [row] = await this.dbService.db
      .select({
        clientType: oauthClients.clientType,
        tenantId: oauthClients.tenantId,
        clientSecretHash: oauthClients.clientSecretHash,
        previousSecretHash: oauthClients.previousSecretHash,
      })
      .from(oauthClients)
      .where(and(eq(oauthClients.clientId, clientId), eq(oauthClients.isActive, true)))
      .limit(1);
    return row ?? null;
  }

  async countClientsFixedTo(tenantId: string, tx: UserServiceTx): Promise<number> {
    const rows = await tx
      .select({ clientId: oauthClients.clientId })
      .from(oauthClients)
      .where(eq(oauthClients.tenantId, tenantId));
    return rows.length;
  }

  async lockClient(clientId: string, tx: UserServiceTx): Promise<ClientUris | null> {
    const [row] = await tx
      .select(clientUris)
      .from(oauthClients)
      .where(eq(oauthClients.clientId, clientId))
      .for('update');
    return row ?? null;
  }

  /** 웹 직원 앱 클라이언트(고정 테넌트 없음) 전부를 잠근다. */
  async lockStaffClients(tx: UserServiceTx): Promise<ClientUris[]> {
    return tx.select(clientUris).from(oauthClients).where(isNull(oauthClients.tenantId)).for('update');
  }

  async setClientUris(
    clientId: string,
    uris: { redirectUris: string[]; postLogoutRedirectUris: string[] | null },
    tx: UserServiceTx,
  ): Promise<void> {
    await tx
      .update(oauthClients)
      .set({ ...uris, updatedAt: new Date() })
      .where(eq(oauthClients.clientId, clientId));
  }
}
