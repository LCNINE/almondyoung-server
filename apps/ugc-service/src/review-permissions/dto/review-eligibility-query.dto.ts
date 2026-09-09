import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@app/shared/dto';

export const ELIGIBILITY_STATUS_OPTIONS = ['available', 'consumed'] as const;
export type EligibilityStatus = (typeof ELIGIBILITY_STATUS_OPTIONS)[number];

export class ReviewEligibilityListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: '상품 ID (UUID)',
    example: 'f7b98c38-2d6f-4b37-8b6b-2f68b1c15b0a',
  })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({
    description: '주문 ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiPropertyOptional({
    description: '자격 상태 필터 (available: 작성 가능, consumed: 작성 완료)',
    enum: ELIGIBILITY_STATUS_OPTIONS,
    default: 'available',
  })
  @IsOptional()
  @IsIn(ELIGIBILITY_STATUS_OPTIONS)
  status?: EligibilityStatus;
}
