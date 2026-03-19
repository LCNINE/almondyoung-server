import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsInt, Min, Max } from 'class-validator';

export class ProductRankingQueryDto {
  @ApiPropertyOptional({
    description: 'Category id filter for product ranking.',
  })
  @IsOptional()
  categoryId?: string;

  @ApiPropertyOptional({
    description: 'Maximum number of results to return.',
    example: 10,
    default: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}
