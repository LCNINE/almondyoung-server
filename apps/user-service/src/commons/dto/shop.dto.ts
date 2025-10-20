import { ApiProperty } from '@nestjs/swagger';
import type { Shop } from 'apps/user-service/database/drizzle/schema';

export class ShopResponseDto implements Shop {
  @ApiProperty({
    description: '상점 ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: '생성일시',
    example: '2024-01-01T00:00:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: '수정일시',
    example: '2024-01-01T00:00:00Z',
  })
  updatedAt: Date;

  @ApiProperty({
    description: '사용자 ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  userId: string;

  @ApiProperty({
    description: '운영 여부',
    example: true,
  })
  isOperating: boolean;

  @ApiProperty({
    description: '운영 연수',
    example: 5,
    nullable: true,
  })
  yearsOperating: number | null;

  @ApiProperty({
    description: '상점 유형',
    enum: ['small', 'solo', 'large'],
    example: 'small',
    nullable: true,
  })
  shopType: 'small' | 'solo' | 'large' | null;

  @ApiProperty({
    description: '취급 카테고리',
    example: ['의류', '잡화'],
    nullable: true,
  })
  categories: unknown;

  @ApiProperty({
    description: '타겟 고객층',
    example: ['20대', '30대'],
    nullable: true,
  })
  targetCustomers: unknown;

  @ApiProperty({
    description: '영업일',
    example: ['월', '화', '수', '목', '금'],
    nullable: true,
  })
  openDays: unknown;
}
