import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AnalyticsSummaryDto {
  @ApiProperty({ example: 0, description: 'Total events processed.' })
  totalEvents: number;

  @ApiProperty({ example: 0, description: 'Products tracked in aggregates.' })
  productsTracked: number;

  @ApiPropertyOptional({
    example: '2025-01-01T00:00:00.000Z',
    nullable: true,
    description: 'Last aggregation timestamp.',
  })
  lastAggregatedAt?: string | null;
}
