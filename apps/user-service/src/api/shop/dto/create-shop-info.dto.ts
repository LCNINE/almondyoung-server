import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SHOP_TYPES, ShopType } from '../../../../database/drizzle/schema';

export class CreateShopInfoDto {
  @ApiProperty({
    description: '상점 운영 여부',
    example: true,
  })
  @IsBoolean({ message: '운영 여부는 불리언 값이어야 합니다.' })
  isOperating: boolean;

  @ApiProperty({
    description: '운영 기간 (년)',
    example: 5,
    required: false,
  })
  @IsNumber({ allowNaN: false }, { message: '운영 기간은 숫자여야 합니다.' })
  @IsOptional()
  yearsOperating?: number;

  @ApiProperty({
    description: '상점 유형',
    enum: SHOP_TYPES,
    example: 'retail',
  })
  @IsEnum(SHOP_TYPES, { message: '유효하지 않은 샵 타입입니다.' })
  shopType: ShopType;

  @ApiProperty({
    description: '상점 카테고리 목록',
    example: ['의류', '잡화'],
    type: [String],
  })
  @IsArray({ message: '카테고리는 배열이어야 합니다.' })
  categories: string[];

  @ApiProperty({
    description: '커스텀 카테고리',
    example: '수제 악세서리',
    required: false,
  })
  @IsString({ message: '커스텀 카테고리는 문자열이어야 합니다.' })
  @IsOptional()
  customCategory?: string;

  @ApiProperty({
    description: '대상 고객 그룹',
    example: ['20대', '30대'],
    type: [String],
    required: false,
  })
  @IsArray({ message: '대상 고객은 배열이어야 합니다.' })
  @IsOptional()
  targetCustomers?: string[];

  @ApiProperty({
    description: '영업일',
    example: ['월', '화', '수', '목', '금'],
    type: [String],
    required: false,
  })
  @IsArray({ message: '운영 요일은 배열이어야 합니다.' })
  @IsOptional()
  openDays?: string[];
}
