import { DbService, InjectDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import { userServiceSchema, type UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { ShopResponseDto } from 'apps/user-service/src/commons/dto/shop.dto';
import { DbTransaction } from 'apps/user-service/src/commons/types';
import { eq } from 'drizzle-orm';

@Injectable()
export class ShopService {
  constructor(@InjectDb() private readonly dbService: DbService<UserServiceSchema>) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.dbService.db;
  }

  async getShopInfoByUserId(userId: string, tx?: DbTransaction): Promise<ShopResponseDto | null> {
    const client = this.getClient(tx);

    const [shop] = await client
      .select()
      .from(userServiceSchema.shops)
      .where(eq(userServiceSchema.shops.userId, userId))
      .limit(1);

    if (!shop) {
      return null;
    }

    return shop;
  }
}
