import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsNumber, MinLength, IsUUID, MaxLength } from 'class-validator';

export class UpdateProductVariantDto {
  @ApiProperty({
    description: '제품 변형 이름',
    minLength: 1,
    required: false,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  variantName?: string;

  @ApiProperty({ description: '품목 이미지 ID', type: String, required: false })
  @IsOptional()
  @IsUUID()
  imageId?: string;

  @ApiProperty({
    description: '변형 상태',
    enum: ['active', 'inactive'],
    required: false,
  })
  @IsOptional()
  @IsEnum(['active', 'inactive'])
  status?: 'active' | 'inactive';

  @ApiProperty({ description: '표시 순서', required: false })
  @IsOptional()
  @IsNumber()
  displayOrder?: number;

  @ApiProperty({ description: '외부 식별자 (채널 어댑터에서 바코드로 매핑)', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  variantCode?: string;
}

export class UpdateVariantStatusDto {
  @ApiProperty({
    description: '새로운 변형 상태',
    enum: ['active', 'inactive'],
  })
  @IsEnum(['active', 'inactive'])
  status: 'active' | 'inactive';
}
