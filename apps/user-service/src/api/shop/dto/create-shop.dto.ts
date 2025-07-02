import { IsArray, IsEnum, IsString } from 'class-validator';
import {
  CustomerType,
  CUSTOMER_TYPES,
  ShopCategory,
  SHOP_CATEGORIES,
  ShopType,
  SHOP_TYPES,
} from '../../../../database/drizzle/schema';

export class CreateShopDto {
  @IsString()
  name: string;

  @IsEnum(SHOP_CATEGORIES, { message: '유효하지 않은 샵 카테고리입니다.' })
  category: ShopCategory;

  @IsEnum(SHOP_TYPES, { message: '유효하지 않은 샵 타입입니다.' })
  type: ShopType;

  @IsArray()
  @IsEnum(CUSTOMER_TYPES, {
    each: true,
    message: '유효하지 않은 고객 타입입니다.',
  })
  targetCustomers: CustomerType[];
}
