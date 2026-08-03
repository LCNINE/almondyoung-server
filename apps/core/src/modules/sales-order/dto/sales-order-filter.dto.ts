import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsEnum, IsDateString, IsInt, Min, IsIn, IsString, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';
import { orderStatusEnum, salesChannelEnum } from '../schema/sales-order.schema';

const orderStatusValues = orderStatusEnum.enumValues;
type OrderStatusEnum = (typeof orderStatusValues)[number];

const salesChannelValues = salesChannelEnum.enumValues;
type SalesChannelEnum = (typeof salesChannelValues)[number];

// 구분 필터 — 재고/매칭 상태 파생 (어드민 주문내역 화면 '구분')
export const ORDER_TYPE_GROUPS = [
  'all', // 전체
  'pending', // 주문 미확정
  'ready', // 완전출고 (모든 라인 재고차감)
  'partial', // 부분출고 (일부 라인만 재고차감)
  'hold', // 출고불가 (재고부족 라인 존재)
  'unmatched', // 매칭안됨 (미매칭 라인 존재)
  'direct', // 직배송 (drop_ship FO 존재)
] as const;
export type OrderTypeGroup = (typeof ORDER_TYPE_GROUPS)[number];

export const ORDER_KEYWORD_TYPES = ['all', 'orderNo', 'receiver', 'phone', 'product'] as const;
export type OrderKeywordType = (typeof ORDER_KEYWORD_TYPES)[number];

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1';

export class SalesOrderFilterDto {
  @ApiPropertyOptional({ description: '조회 시작일 (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: '조회 종료일 (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: '판매 채널', enum: salesChannelValues })
  @IsOptional()
  @IsEnum(salesChannelValues)
  channel?: SalesChannelEnum;

  @ApiPropertyOptional({ description: '주문 상태(단일)', enum: orderStatusValues })
  @IsOptional()
  @IsEnum(orderStatusValues)
  status?: OrderStatusEnum;

  @ApiPropertyOptional({ description: '구분 (재고/매칭 상태)', enum: ORDER_TYPE_GROUPS })
  @IsOptional()
  @IsIn(ORDER_TYPE_GROUPS)
  typeGroup?: OrderTypeGroup;

  @ApiPropertyOptional({ description: "취소/타임아웃 제외 (typeGroup='all'일 때)" })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  excludeTerminal?: boolean;

  @ApiPropertyOptional({ description: '환불 실패/수동처리 주문만' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  refundIssueOnly?: boolean;

  @ApiPropertyOptional({ description: '키워드' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ description: '키워드 검색 대상', enum: ORDER_KEYWORD_TYPES })
  @IsOptional()
  @IsIn(ORDER_KEYWORD_TYPES)
  keywordType?: OrderKeywordType;

  @ApiPropertyOptional({ description: '조회할 최대 개수', default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10))
  limit?: number = 20;

  @ApiPropertyOptional({ description: '건너뛸 개수', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) => parseInt(value, 10))
  offset?: number = 0;
}
