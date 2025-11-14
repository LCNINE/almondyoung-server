import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, IsOptional, IsNumber, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class BulkUpdatesDto {
  @ApiProperty({ description: '상태', required: false })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ description: '표시 순서', required: false })
  @IsOptional()
  @IsNumber()
  displayOrder?: number;

  @ApiProperty({ description: '이미지 목록', type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];
}

export class UpdateVariantBulkDto {
  @ApiProperty({ 
    description: '변형 ID 목록',
    type: [String],
    minItems: 1
  })
  @IsArray()
  @MinLength(1)
  @IsString({ each: true })
  variantIds: string[];

  @ApiProperty({ description: '수정할 정보', type: BulkUpdatesDto })
  @ValidateNested()
  @Type(() => BulkUpdatesDto)
  updates: BulkUpdatesDto;
}

