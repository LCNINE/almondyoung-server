import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, ValidateIf } from 'class-validator';
import { PaginationQueryDto } from '@app/shared';
import { RefundKind, refundKindEnum } from '../../schema';

/** 목록 필터의 «모름» — kind 가 null 인 행. DB 에는 없는 값이라 enum 밖에 둔다. */
export const REFUND_KIND_FILTER_UNKNOWN = 'UNKNOWN';

export class AdminRefundListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by status (PENDING, SUCCEEDED, FAILED)' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Date range start (ISO date)' })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Date range end (ISO date)' })
  @IsOptional()
  @IsString()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Filter by payment intent ID' })
  @IsOptional()
  @IsString()
  intentId?: string;

  @ApiPropertyOptional({
    enum: [...refundKindEnum.enumValues, REFUND_KIND_FILTER_UNKNOWN],
    description: '종류로 거른다. UNKNOWN 은 종류가 null(모름)인 행',
  })
  @IsOptional()
  @IsIn([...refundKindEnum.enumValues, REFUND_KIND_FILTER_UNKNOWN])
  kind?: RefundKind | typeof REFUND_KIND_FILTER_UNKNOWN;
}

export class ChangeRefundKindDto {
  @ApiProperty({
    enum: refundKindEnum.enumValues,
    nullable: true,
    description: '고칠 종류. null 은 «모름»으로 비우기. 생략은 허용하지 않는다',
  })
  @ValidateIf((_, value) => value !== null)
  @IsIn(refundKindEnum.enumValues)
  kind: RefundKind | null;
}
