import { IsOptional, IsString, IsInt, Min, Max, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';

/** `GET /inventory/skus` 쿼리. 응답은 배열 그대로다(warehouse-app 바코드 조회가 배열을 기대한다). */
export class SkuSearchQueryDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  id?: string;

  @ApiProperty({ required: false, description: 'SKU 코드 (정확일치)' })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  barcode?: string;

  @ApiProperty({ required: false, description: 'SKU 이름 (부분일치)' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ required: false, description: '공급사 이름 (부분일치)' })
  @IsString()
  @IsOptional()
  supplierName?: string;

  @ApiProperty({ required: false, type: Boolean })
  @Transform(({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  @IsOptional()
  inventoryManagement?: boolean;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  groupId?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  holderId?: string;

  @ApiProperty({ description: 'Page limit', default: 50, minimum: 1, maximum: 200, required: false })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  limit?: number = 50;

  @ApiProperty({ description: 'Page offset', default: 0, minimum: 0, required: false })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  offset?: number = 0;
}
