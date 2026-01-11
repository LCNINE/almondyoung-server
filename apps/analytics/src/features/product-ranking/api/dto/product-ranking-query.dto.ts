import { ApiPropertyOptional } from '@nestjs/swagger';

export class ProductRankingQueryDto {
  @ApiPropertyOptional({
    description: 'Category id filter for product ranking.',
  })
  categoryId?: string;
}
