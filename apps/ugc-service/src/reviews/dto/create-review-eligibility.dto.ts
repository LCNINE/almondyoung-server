import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsUUID, IsArray, ArrayMinSize, ValidateNested } from 'class-validator';

export class CreateReviewEligibilityItemDto {
  @ApiProperty({ description: '상품 ID' })
  @IsString()
  @IsNotEmpty()
  productId: string;

  @ApiProperty({ description: '주문 라인 ID' })
  @IsString()
  @IsNotEmpty()
  orderLineId: string;
}

export class CreateReviewEligibilityDto {
  @ApiProperty({ description: '사용자 ID' })
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ description: '주문 ID' })
  @IsString()
  @IsNotEmpty()
  orderId: string;

  @ApiProperty({
    description: '주문 라인 항목 목록',
    type: [CreateReviewEligibilityItemDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateReviewEligibilityItemDto)
  items: CreateReviewEligibilityItemDto[];
}
