import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsInt, Min, Max } from 'class-validator';

export class FrequentlyPurchasedDto {
  @ApiProperty({ description: 'PIM Master ID' })
  masterId: string;

  @ApiPropertyOptional({ description: 'Channel product ID (Medusa 등)' })
  channelProductId: string | null;

  @ApiProperty({ description: '구매 횟수' })
  purchaseCount: number;

  @ApiProperty({ description: '총 구매 수량' })
  totalQuantity: number;

  @ApiPropertyOptional({ description: '마지막 구매일' })
  lastPurchasedAt: string | null;
}

export class FrequentlyPurchasedQueryDto {
  @ApiPropertyOptional({
    description: '조회할 최대 개수',
    example: 20,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
