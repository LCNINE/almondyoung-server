import { DbService, InjectDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import { userServiceSchema, type UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import type { PublicClientOriginSource } from './public-client-cors';

@Injectable()
export class PublicClientOriginsRepository {
  constructor(@InjectDb() private readonly dbService: DbService<UserServiceSchema>) {}

  // 공개·활성 여부는 collectPublicClientOrigins 가 한 곳에서 거른다. 테이블은 클라이언트 수만큼이라 작다.
  async findOriginSources(): Promise<PublicClientOriginSource[]> {
    const { oauthClients } = userServiceSchema;
    return this.dbService.db
      .select({
        clientType: oauthClients.clientType,
        isActive: oauthClients.isActive,
        redirectUris: oauthClients.redirectUris,
      })
      .from(oauthClients);
  }
}
