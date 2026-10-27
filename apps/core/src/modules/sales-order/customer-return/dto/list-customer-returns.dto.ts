import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const CUSTOMER_RETURN_BUCKETS = ['open', 'attention', 'closed'] as const;
export type CustomerReturnBucket = (typeof CUSTOMER_RETURN_BUCKETS)[number];

/** 반품 목록 쿼리 (K8 PR7 N2) — open: 진행 중, attention: 그중 확인 필요, closed: 정산 완료·취소 */
export class ListCustomerReturnsQueryDto {
  @ApiPropertyOptional({ enum: CUSTOMER_RETURN_BUCKETS, default: 'open' })
  @IsOptional()
  @IsIn(CUSTOMER_RETURN_BUCKETS)
  bucket: CustomerReturnBucket = 'open';

  @ApiPropertyOptional({ maxLength: 64, description: '주문번호·채널 주문 id 정확 일치, 고객명 부분 일치' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  q?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}
