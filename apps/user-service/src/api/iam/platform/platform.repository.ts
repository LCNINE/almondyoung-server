import { DbService, InjectDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import {
  oauthClients,
  oauthTokens,
  tenantDomains,
  tenants,
  tokens,
  users,
  type UserServiceSchema,
  type UserServiceTx,
} from 'apps/user-service/database/drizzle/schema';
import { and, eq, inArray, isNull } from 'drizzle-orm';

export type TenantStatus = (typeof tenants.$inferSelect)['status'];

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

  /** 소속·부여·세션·도메인은 FK cascade 로 함께 지워진다. */
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

  async domainsOfAll(): Promise<{ host: string; tenantId: string }[]> {
    return this.dbService.db
      .select({ host: tenantDomains.host, tenantId: tenantDomains.tenantId })
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

  async insertDomains(tenantId: string, hosts: readonly string[], tx: UserServiceTx): Promise<void> {
    if (hosts.length === 0) return;
    await tx.insert(tenantDomains).values(hosts.map((host) => ({ host, tenantId })));
  }

  // ── 브랜드(비인증 조회)

  async findBrandByHost(
    host: string,
  ): Promise<{ displayName: string; logoUrl: string | null; status: TenantStatus } | null> {
    const [row] = await this.dbService.db
      .select({ displayName: tenants.displayName, logoUrl: tenants.logoUrl, status: tenants.status })
      .from(tenantDomains)
      .innerJoin(tenants, eq(tenants.id, tenantDomains.tenantId))
      .where(eq(tenantDomains.host, host))
      .limit(1);
    return row ?? null;
  }

  // ── OAuth 클라이언트

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
