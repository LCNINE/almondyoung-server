import { DbService, InjectDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import { type UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../../database/drizzle/schema';
import { CreateShopInfoDto } from './dto/create-shop-info.dto';
import { UpdateShopInfoDto } from './dto/update-shop-info';
import { ShopException } from './exceptions/shop.exceptions';

@Injectable()
export class ShopService {
  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
  ) { }

  async createShopInfo(
    createShopDto: CreateShopInfoDto,
    userId: string,
  ): Promise<void> {
    const shopData = {
      shopType: createShopDto.shopType,
      categories: createShopDto.categories,
      targetCustomers: createShopDto.targetCustomers,
      openDays: createShopDto.openDays,
      isOperating: createShopDto.isOperating,
      yearsOperating: createShopDto.yearsOperating,
      updatedAt: new Date(),
    };

    const existingShop = await this.findOneByUserId(userId);

    if (existingShop) {
      throw new ShopException({ message: '상점 정보가 이미 존재합니다.', errorCode: 'SHOP_INFO_ALREADY_EXISTS' })
    }

    await this.dbService.db
      .insert(schema.shops)
      .values({
        userId: userId,
        ...shopData,
      })

    return;
  }


  async updateShopInfo(
    updateShopDto: UpdateShopInfoDto,
    userId: string,
  ): Promise<void> {
    const shopData = {
      shopType: updateShopDto.shopType,
      categories: updateShopDto.categories,
      targetCustomers: updateShopDto.targetCustomers,
      openDays: updateShopDto.openDays,
      isOperating: updateShopDto.isOperating,
      yearsOperating: updateShopDto.yearsOperating,
      updatedAt: new Date(),
    };

    const existingShop = await this.findOneByUserId(userId);

    if (!existingShop) {
      throw new ShopException({ message: '상점 정보가 존재하지 않습니다.', errorCode: 'SHOP_INFO_NOT_FOUND' })
    }

    await this.dbService.db
      .update(schema.shops)
      .set(shopData)
      .where(eq(schema.shops.userId, userId));

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
