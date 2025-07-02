import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { SHOP_TYPES, ShopType } from '../../../../database/drizzle/schema';

export class CreateShopInfoDto {
  @IsBoolean()
  isOperating: boolean;

  @IsNumber()
  @IsOptional()
  yearsOperating?: number;

  @IsEnum(SHOP_TYPES, { message: '유효하지 않은 샵 타입입니다.' })
  shopType: ShopType;

  @IsArray()
  categories: string[];

  @IsString()
  @IsOptional()
  customCategory?: string;

  @IsArray()
  @IsOptional()
  targetCustomers?: string[];

  @IsArray()
  @IsOptional()
  openDays?: string[];
}
