import { Injectable } from '@nestjs/common';
import { CreateShopInfoDto } from './dto/create-shop-info.dto';
import { UpdateShopInfoDto } from './dto/update-shop-info';
import { User } from 'apps/user-service/database/drizzle/schema';
import { DbService, InjectDb } from '@app/db';
import * as schema from '../../../database/drizzle/schema';
import { Shop } from './entities/shop.entity';

@Injectable()
export class ShopService {
  constructor(@InjectDb() private readonly dbService: DbService<schema.Shop>) {}
  async create(createShopDto: CreateShopInfoDto, user: User) {
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

  findOne(id: number) {
    return `This action returns a #${id} shop`;
  }

  update(id: number, updateShopDto: UpdateShopInfoDto) {
    return `This action updates a #${id} shop`;
  }

  remove(id: number) {
    return `This action removes a #${id} shop`;
  }
}
