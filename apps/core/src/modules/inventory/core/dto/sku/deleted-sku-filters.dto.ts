import { IsOptional, IsString, IsInt, Min, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class DeletedSkuFiltersDto {
  @ApiProperty({
    description: 'SKU 이름 검색 (Search by SKU name)',
    required: false,
    example: 'lash',
  })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiProperty({
    description: '삭제 시작일 (Deleted start date - YYYY-MM-DD)',
    required: false,
    example: '2025-01-01',
  })
  @IsDateString()
  @IsOptional()
  deletedStartDate?: string;

  @ApiProperty({
    description: '삭제 종료일 (Deleted end date - YYYY-MM-DD)',
    required: false,
    example: '2025-12-31',
  })
  @IsDateString()
  @IsOptional()
  deletedEndDate?: string;

  @ApiProperty({
    description: 'Page limit',
    default: 50,
    minimum: 1,
    maximum: 200,
    required: false,
    example: 50,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 50;

  @ApiProperty({
    description: 'Page offset',
    default: 0,
    minimum: 0,
    required: false,
    example: 0,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  offset?: number = 0;
}
