import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProductOrderMetricDto {
  @ApiProperty({ example: '01HXYZ1234567890ABCDEFGH' })
  masterId: string;

  @ApiProperty({ example: 3, description: 'Number of orders that included the product.' })
  ordersCount: number;

  @ApiProperty({ example: 12, description: 'Total quantity sold across orders.' })
  quantitySold: number;

  @ApiPropertyOptional({ example: '2025-01-01T00:00:00.000Z', nullable: true })
  lastOrderAt?: string | null;
}
