import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class PaginatedResponseDto<T> {
  data: T[];

  @ApiProperty({
    description: 'Total items',
    example: 100,
    minimum: 0,
  })
  total: number;

  @ApiProperty({
    description: 'Current page (1-based)',
    example: 1,
    minimum: 1,
  })
  page: number;

  @ApiProperty({
    description: 'Items per page',
    example: 20,
    minimum: 1,
  })
  limit: number;
}

export class PaginationQueryDto {
  @ApiProperty({
    description: 'Page number (1-based)',
    required: false,
    default: 1,
    minimum: 1,
    example: 1,
  })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  @Min(1)
  page?: number;

  @ApiProperty({
    description: 'Items per page',
    required: false,
    default: 20,
    minimum: 1,
    maximum: 100,
    example: 20,
  })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  @Min(1)
  limit?: number;
}
