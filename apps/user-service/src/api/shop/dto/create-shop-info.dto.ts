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
  @IsBoolean({ message: '운영 여부는 불리언 값이어야 합니다.' })
  isOperating: boolean;

  @IsNumber({ allowNaN: false }, { message: '운영 기간은 숫자여야 합니다.' })
  @IsOptional()
  yearsOperating?: number;

  @IsEnum(SHOP_TYPES, { message: '유효하지 않은 샵 타입입니다.' })
  shopType: ShopType;

  @IsArray({ message: '카테고리는 배열이어야 합니다.' })
  categories: string[];

  @IsString({ message: '커스텀 카테고리는 문자열이어야 합니다.' })
  @IsOptional()
  customCategory?: string;

  @IsArray({ message: '대상 고객은 배열이어야 합니다.' })
  @IsOptional()
  targetCustomers?: string[];

  @IsArray({ message: '운영 요일은 배열이어야 합니다.' })
  @IsOptional()
  openDays?: string[];
}
