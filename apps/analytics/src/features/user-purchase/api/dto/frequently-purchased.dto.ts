import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '@app/shared/dto';

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

export class FrequentlyPurchasedQueryDto extends PaginationQueryDto {}
