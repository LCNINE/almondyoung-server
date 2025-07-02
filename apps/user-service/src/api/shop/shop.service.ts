import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateShopInfoDto } from './dto/create-shop-info.dto';
import { UpdateShopInfoDto } from './dto/update-shop-info';
import { User } from 'apps/user-service/database/drizzle/schema';
import { DbService, InjectDb } from '@app/db';
import * as schema from '../../../database/drizzle/schema';
import { and, eq } from 'drizzle-orm';

@Injectable()
export class ShopService {
  constructor(@InjectDb() private readonly dbService: DbService<schema.Shop>) {}

  async create(createShopDto: CreateShopInfoDto, user: User): Promise<void> {
    const [existingShop] = await this.dbService.db
      .select()
      .from(schema.shops)
      .where(eq(schema.shops.userId, user.id));

    if (existingShop) {
      throw new ForbiddenException('이미 등록된 샵이 있습니다.');
    }

    await this.dbService.db.insert(schema.shops).values({
      userId: user.id,
      shopType: createShopDto.shopType,
      categories: createShopDto.categories,
      customCategory: createShopDto.customCategory,
      targetCustomers: createShopDto.targetCustomers,
      openDays: createShopDto.openDays,
      isOperating: createShopDto.isOperating,
      yearsOperating: createShopDto.yearsOperating,
    });

    return;
  }

  async update(
    id: string,
    updateShopDto: UpdateShopInfoDto,
    user: User,
  ): Promise<void> {
    const shop = await this.findOneByShopIdAndUserId(id, user.id);

    if (!shop) {
      throw new NotFoundException('샵을 찾을 수 없거나 접근 권한이 없습니다.');
    }

    await this.dbService.db
      .update(schema.shops)
      .set({
        shopType: updateShopDto.shopType,
        categories: updateShopDto.categories,
        customCategory: updateShopDto.customCategory,
        targetCustomers: updateShopDto.targetCustomers,
        openDays: updateShopDto.openDays,
      })
      .where(eq(schema.shops.id, id));
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
