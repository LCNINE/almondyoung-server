import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, IsOptional, IsNumber, MinLength, ValidateNested, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

class BulkUpdateItemDto {
  @ApiProperty({ description: '품목 ID' })
  @IsString()
  id: string;

  @ApiProperty({
    description: '제품 변형 이름',
    minLength: 1,
    required: false
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  variantName?: string;

  @ApiProperty({ description: '상태', required: false })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ description: '표시 순서', required: false })
  @IsOptional()
  @IsNumber()
  displayOrder?: number;

  @ApiProperty({ description: '품목 이미지 ID', type: String, required: false })
  @IsOptional()
  @IsUUID()
  imageId: string;
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

