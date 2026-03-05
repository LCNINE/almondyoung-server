import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsUUID, IsArray, ArrayMinSize, ValidateNested } from 'class-validator';

export class CreateReviewEligibilityItemDto {
  @ApiProperty({ description: '상품 ID (UUID)' })
  @IsUUID()
  productId: string;

  @ApiProperty({ description: '주문 라인 ID (UUID)' })
  @IsUUID()
  orderLineId: string;
}

export class CreateReviewEligibilityDto {
  @ApiProperty({ description: '주문 ID (UUID)' })
  @IsUUID()
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
