import { DbService, InjectDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import { userServiceSchema, type UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { DbTransaction } from '../../commons/types';

type CodeInsert = {
  code: string;
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  scope?: string | null;
  nonce?: string | null;
  expiresAt: Date;
};

type TokenInsert = {
  userId: string;
  clientId: string;
  refreshToken: string;
  scope?: string | null;
  expiresAt: Date;
  rotatedFrom?: string | null;
  tenantId: string;
};

export type OAuthClientRow = typeof userServiceSchema.oauthClients.$inferSelect;

export type OAuthTokenRow = typeof userServiceSchema.oauthTokens.$inferSelect;

/** 토큰 테넌트 판정에 쓰는 테넌트 행의 일부. */
export type TokenTenantRow = Pick<typeof userServiceSchema.tenants.$inferSelect, 'id' | 'status'>;

@Injectable()
export class OAuthRepository {
  constructor(@InjectDb() private readonly dbService: DbService<UserServiceSchema>) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.dbService.db;
  }

  // ─────────────────────────────────────────
  // OAuth clients
  // ─────────────────────────────────────────
  async findActiveClientById(clientId: string, tx?: DbTransaction): Promise<OAuthClientRow | null> {
    const client = this.getClient(tx);
    const [row] = await client
      .select()
      .from(userServiceSchema.oauthClients)
      .where(
        and(eq(userServiceSchema.oauthClients.clientId, clientId), eq(userServiceSchema.oauthClients.isActive, true)),
      )
      .limit(1);
    return row ?? null;
  }

  async findClientById(clientId: string, tx?: DbTransaction): Promise<OAuthClientRow | null> {
    const client = this.getClient(tx);
    const [row] = await client
      .select()
      .from(userServiceSchema.oauthClients)
      .where(eq(userServiceSchema.oauthClients.clientId, clientId))
      .limit(1);
    return row ?? null;
  }

  // ─────────────────────────────────────────
  // Authorization codes
  // ─────────────────────────────────────────
  async insertAuthorizationCode(input: CodeInsert, tx?: DbTransaction): Promise<void> {
    const client = this.getClient(tx);
    await client.insert(userServiceSchema.oauthAuthorizationCodes).values({
      code: input.code,
      clientId: input.clientId,
      userId: input.userId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: input.codeChallengeMethod,
      scope: input.scope ?? null,
      nonce: input.nonce ?? null,
      expiresAt: input.expiresAt,
    });
  }

  async findUnconsumedCode(code: string, tx?: DbTransaction) {
    const client = this.getClient(tx);
    const [row] = await client
      .select()
      .from(userServiceSchema.oauthAuthorizationCodes)
      .where(
        and(
          eq(userServiceSchema.oauthAuthorizationCodes.code, code),
          isNull(userServiceSchema.oauthAuthorizationCodes.consumedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async markCodeConsumed(code: string, tx?: DbTransaction): Promise<void> {
    const client = this.getClient(tx);
    await client
      .update(userServiceSchema.oauthAuthorizationCodes)
      .set({ consumedAt: new Date() })
      .where(eq(userServiceSchema.oauthAuthorizationCodes.code, code));
  }

  // ─────────────────────────────────────────
  // Refresh tokens
  // ─────────────────────────────────────────
  async insertOAuthToken(input: TokenInsert, tx?: DbTransaction) {
    const client = this.getClient(tx);
    const [row] = await client
      .insert(userServiceSchema.oauthTokens)
      .values({
        userId: input.userId,
        clientId: input.clientId,
        refreshToken: input.refreshToken,
        scope: input.scope ?? null,
        expiresAt: input.expiresAt,
        rotatedFrom: input.rotatedFrom ?? null,
        tenantId: input.tenantId,
      })
      .returning();
    return row;
  }

  // ─────────────────────────────────────────
  // 토큰 테넌트 (테넌트 도메인 → 테넌트, 상태)
  // ─────────────────────────────────────────
  async findTenantByHost(host: string, tx?: DbTransaction): Promise<TokenTenantRow | null> {
    const client = this.getClient(tx);
    const [row] = await client
      .select({ id: userServiceSchema.tenants.id, status: userServiceSchema.tenants.status })
      .from(userServiceSchema.tenantDomains)
      .innerJoin(userServiceSchema.tenants, eq(userServiceSchema.tenants.id, userServiceSchema.tenantDomains.tenantId))
      .where(eq(userServiceSchema.tenantDomains.host, host))
      .limit(1);
    return row ?? null;
  }

  async findTenantById(tenantId: string, tx?: DbTransaction): Promise<TokenTenantRow | null> {
    const client = this.getClient(tx);
    const [row] = await client
      .select({ id: userServiceSchema.tenants.id, status: userServiceSchema.tenants.status })
      .from(userServiceSchema.tenants)
      .where(eq(userServiceSchema.tenants.id, tenantId))
      .limit(1);
    return row ?? null;
  }

  async findOAuthTokenByRefresh(refreshToken: string, tx?: DbTransaction, forUpdate = false) {
    const client = this.getClient(tx);
    const base = client
      .select()
      .from(userServiceSchema.oauthTokens)
      .where(eq(userServiceSchema.oauthTokens.refreshToken, refreshToken))
      .limit(1);
    // forUpdate: 동일 refresh token 에 대한 동시 회전 요청을 row lock 으로 직렬화한다.
    // (iOS WebKit 의 중복 fetch 가 SELECT→UPDATE race 를 만들어 reuse 오탐을 일으키는 것을 막는다.)
    const [row] = forUpdate ? await base.for('update') : await base;
    return row ?? null;
  }

  /** rotation chain 에서 주어진 부모로부터 회전되어 나온 자식 토큰을 찾는다 (reuse grace 판정용). */
  async findChildToken(parentId: string, tx?: DbTransaction) {
    const client = this.getClient(tx);
    const [row] = await client
      .select()
      .from(userServiceSchema.oauthTokens)
      .where(eq(userServiceSchema.oauthTokens.rotatedFrom, parentId))
      .limit(1);
    return row ?? null;
  }

  async revokeTokenById(id: string, tx?: DbTransaction): Promise<void> {
    const client = this.getClient(tx);
    await client
      .update(userServiceSchema.oauthTokens)
      .set({ isRevoked: true, updatedAt: new Date() })
      .where(eq(userServiceSchema.oauthTokens.id, id));
  }

  /** SLO: 사용자의 모든 OAuth refresh token을 일괄 revoke. */
  async revokeAllUserTokens(userId: string, tx?: DbTransaction): Promise<void> {
    const client = this.getClient(tx);
    await client
      .update(userServiceSchema.oauthTokens)
      .set({ isRevoked: true, updatedAt: new Date() })
      .where(
        and(
          eq(userServiceSchema.oauthTokens.userId, userId),
          eq(userServiceSchema.oauthTokens.isRevoked, false),
        ),
      );
  }

  /**
   * rotation chain 전체 revoke. reuse detection 시 호출.
   * rotatedFrom으로 거슬러 올라간 root를 찾고, 그 root의 모든 후손을 BFS로 revoke.
   */
  async revokeChain(anyTokenId: string, tx?: DbTransaction): Promise<void> {
    const client = this.getClient(tx);

    // 1. root 찾기 (rotatedFrom이 null이거나 더 이상 부모가 없는 노드)
    let currentId: string = anyTokenId;
    while (true) {
      const [parent] = await client
        .select({ rotatedFrom: userServiceSchema.oauthTokens.rotatedFrom })
        .from(userServiceSchema.oauthTokens)
        .where(eq(userServiceSchema.oauthTokens.id, currentId))
        .limit(1);
      if (!parent?.rotatedFrom) break;
      currentId = parent.rotatedFrom;
    }
    const rootId = currentId;

    // 2. root + 후손 모두 수집
    const visited = new Set<string>([rootId]);
    let frontier: string[] = [rootId];
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const id of frontier) {
        const children = await client
          .select({ id: userServiceSchema.oauthTokens.id })
          .from(userServiceSchema.oauthTokens)
          .where(eq(userServiceSchema.oauthTokens.rotatedFrom, id));
        for (const c of children) {
          if (!visited.has(c.id)) {
            visited.add(c.id);
            next.push(c.id);
          }
        }
      }
      frontier = next;
    }

    // 3. 한 번에 revoke
    for (const id of visited) {
      await client
        .update(userServiceSchema.oauthTokens)
        .set({ isRevoked: true, updatedAt: new Date() })
        .where(eq(userServiceSchema.oauthTokens.id, id));
    }
  }
}
