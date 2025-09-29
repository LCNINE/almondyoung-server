import { DbService, InjectDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import {
  User,
  type UserServiceSchema,
} from 'apps/user-service/database/drizzle/schema';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../../database/drizzle/schema';
import { CreateShopInfoDto } from './dto/create-shop-info.dto';

@Injectable()
export class ShopService {
  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
  ) {}

  async modify(createShopDto: CreateShopInfoDto, user: User): Promise<void> {
    const shopData = {
      shopType: createShopDto.shopType,
      categories: createShopDto.categories,
      targetCustomers: createShopDto.targetCustomers,
      openDays: createShopDto.openDays,
      isOperating: createShopDto.isOperating,
      yearsOperating: createShopDto.yearsOperating,
      updatedAt: new Date(),
    };

    await this.dbService.db
      .insert(schema.shops)
      .values({
        userId: user.id,
        ...shopData,
      })
      .onConflictDoUpdate({
        target: [schema.shops.userId],
        set: shopData,
      })
      .execute();

    return;
  }

  /**
   *
   * return undefined 뜨면 shop 데이터 없는거임
   */
  async findOneByUserId(userId: string): Promise<schema.Shop | undefined> {
    const [shop] = await this.dbService.db
      .select()
      .from(schema.shops)
      .where(eq(schema.shops.userId, userId));

    return shop;
  }

  async findOneByShopIdAndUserId(
    shopId: string,
    userId: string,
  ): Promise<schema.Shop | undefined> {
    const [shop] = await this.dbService.db
      .select()
      .from(schema.shops)
      .where(and(eq(schema.shops.id, shopId), eq(schema.shops.userId, userId)));

    return shop;
  }
}
