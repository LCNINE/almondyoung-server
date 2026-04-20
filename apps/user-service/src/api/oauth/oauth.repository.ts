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
  expiresAt: Date;
};

type TokenInsert = {
  userId: string;
  clientId: string;
  refreshToken: string;
  scope?: string | null;
  expiresAt: Date;
  rotatedFrom?: string | null;
};

@Injectable()
export class OAuthRepository {
  constructor(@InjectDb() private readonly dbService: DbService<UserServiceSchema>) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.dbService.db;
  }

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
      })
      .returning();
    return row;
  }

  async findOAuthTokenByRefresh(refreshToken: string, tx?: DbTransaction) {
    const client = this.getClient(tx);
    const [row] = await client
      .select()
      .from(userServiceSchema.oauthTokens)
      .where(eq(userServiceSchema.oauthTokens.refreshToken, refreshToken))
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
