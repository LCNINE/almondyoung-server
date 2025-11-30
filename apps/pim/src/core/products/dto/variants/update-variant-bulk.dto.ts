import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, IsOptional, IsNumber, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class BulkUpdateItemDto {
  @ApiProperty({ description: '품목 ID' })
  @IsString()
  id: string;

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
    description: '수정할 변형 정보 배열',
    type: [BulkUpdateItemDto],
    minItems: 1
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkUpdateItemDto)
  updates: BulkUpdateItemDto[];
}

