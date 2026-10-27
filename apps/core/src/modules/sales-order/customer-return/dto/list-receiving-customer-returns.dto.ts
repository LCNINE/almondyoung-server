import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

/** 창고 반품 도착 대기 목록 쿼리 (K8 PR7b N2) — 그 창고가 받을 반품만 */
export class ListReceivingCustomerReturnsQueryDto {
  @ApiProperty({ format: 'uuid', description: '받는 창고' })
  @IsUUID()
  warehouseId: string;

  @ApiPropertyOptional({ maxLength: 64, description: '주문번호·채널 주문 id 정확 일치, 고객명 부분 일치' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  q?: string;

  @ApiPropertyOptional({ maxLength: 64, description: '이 바코드를 가진 SKU 의 항목이 있는 반품만(정확 일치)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 100;
}
