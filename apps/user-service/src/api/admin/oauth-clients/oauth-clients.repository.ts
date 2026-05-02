import { DbService, InjectDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import { userServiceSchema, type UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { eq } from 'drizzle-orm';

export type OAuthClientRow = typeof userServiceSchema.oauthClients.$inferSelect;

type CreateInput = {
  clientId: string;
  clientType: 'confidential' | 'public';
  clientSecretHash: string;
  redirectUris: string[];
  postLogoutRedirectUris?: string[] | null;
  allowedScopes: string[] | null;
};

type UpdateInput = {
  redirectUris?: string[];
  postLogoutRedirectUris?: string[] | null;
  allowedScopes?: string[] | null;
  isActive?: boolean;
  deactivatedAt?: Date | null;
};

@Injectable()
export class OAuthClientsRepository {
  constructor(@InjectDb() private readonly dbService: DbService<UserServiceSchema>) {}

  async findAll(): Promise<OAuthClientRow[]> {
    return this.dbService.db
      .select()
      .from(userServiceSchema.oauthClients)
      .orderBy(userServiceSchema.oauthClients.createdAt);
  }

  async findById(clientId: string): Promise<OAuthClientRow | null> {
    const [row] = await this.dbService.db
      .select()
      .from(userServiceSchema.oauthClients)
      .where(eq(userServiceSchema.oauthClients.clientId, clientId))
      .limit(1);
    return row ?? null;
  }

  async create(input: CreateInput): Promise<OAuthClientRow> {
    const [row] = await this.dbService.db
      .insert(userServiceSchema.oauthClients)
      .values({
        clientId: input.clientId,
        clientType: input.clientType,
        clientSecretHash: input.clientSecretHash,
        redirectUris: input.redirectUris,
        postLogoutRedirectUris: input.postLogoutRedirectUris ?? null,
        allowedScopes: input.allowedScopes,
      })
      .returning();
    return row;
  }

  async update(clientId: string, patch: UpdateInput): Promise<OAuthClientRow> {
    const [row] = await this.dbService.db
      .update(userServiceSchema.oauthClients)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(userServiceSchema.oauthClients.clientId, clientId))
      .returning();
    return row;
  }

  async rotateSecret(clientId: string, currentHash: string, newHash: string): Promise<OAuthClientRow> {
    const [row] = await this.dbService.db
      .update(userServiceSchema.oauthClients)
      .set({
        clientSecretHash: newHash,
        previousSecretHash: currentHash,
        secretRotatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(userServiceSchema.oauthClients.clientId, clientId))
      .returning();
    return row;
  }

  async clearPreviousSecret(clientId: string): Promise<OAuthClientRow> {
    const [row] = await this.dbService.db
      .update(userServiceSchema.oauthClients)
      .set({ previousSecretHash: null, updatedAt: new Date() })
      .where(eq(userServiceSchema.oauthClients.clientId, clientId))
      .returning();
    return row;
  }
}
