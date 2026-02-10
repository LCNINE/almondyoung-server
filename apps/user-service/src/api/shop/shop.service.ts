import { DbService, InjectDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import { type UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../../database/drizzle/schema';
import { CreateShopInfoDto } from './dto/create-shop-info.dto';
import { UpdateShopInfoDto } from './dto/update-shop-info';
import { ShopException } from './exceptions/shop.exceptions';
import { REMIND_AFTER_DAYS } from '../../constants/shop-survey';

@Injectable()
export class ShopService {
  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
  ) { }

  async createShopInfo(createShopDto: CreateShopInfoDto, userId: string): Promise<void> {
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

    if (existingShop && existingShop.categories) {
      // 이미 설문 완료된 유저
      throw new ShopException({ message: '상점 정보가 이미 존재합니다.', errorCode: 'SHOP_INFO_ALREADY_EXISTS' });
    }

    if (existingShop) {
      // 건너뛰기로 빈 레코드만 있는 유저 → update
      await this.dbService.db.update(schema.shops)
        .set(shopData)
        .where(eq(schema.shops.userId, userId));
    } else {
      // 완전 신규 유저 → insert
      await this.dbService.db.insert(schema.shops)
        .values({ userId, ...shopData });
    }
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
   * userId로 상점 정보 조회.
   * 없으면 null 반환 → 프론트에서 data === null 이면 설문 등 처리 가능.
   */
  async findOneByUserId(userId: string): Promise<schema.Shop | null> {
    const [shop] = await this.dbService.db
      .select()
      .from(schema.shops)
      .where(eq(schema.shops.userId, userId));

    return shop ?? null;
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


  async updateRemindAt(userId: string) {
    const remindAt = new Date();
    remindAt.setDate(remindAt.getDate() + REMIND_AFTER_DAYS);

    const existingShop = await this.findOneByUserId(userId);

    if (existingShop) {
      await this.dbService.db.update(schema.shops)
        .set({ remind_at: remindAt })
        .where(eq(schema.shops.userId, userId));
    } else {
      await this.dbService.db.insert(schema.shops)
        .values({ userId, remind_at: remindAt });
    }
  }

}
