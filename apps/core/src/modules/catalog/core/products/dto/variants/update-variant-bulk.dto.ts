import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { UpdateProductVariantDto } from './update-variant.dto';

export class BulkUpdateItemDto extends UpdateProductVariantDto {
  @ApiProperty({ description: '품목 ID' })
  @IsString()
  id: string;
}

export class UpdateVariantBulkDto {
  @ApiProperty({
    description: '수정할 변형 정보 배열',
    type: [BulkUpdateItemDto],
    minItems: 1,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkUpdateItemDto)
  updates: BulkUpdateItemDto[];
}
