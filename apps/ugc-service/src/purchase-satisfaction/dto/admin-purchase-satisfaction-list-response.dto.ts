import { ApiProperty } from '@nestjs/swagger';
import { PURCHASE_SATISFACTION_REASONS, type PurchaseSatisfactionReason } from '../types';
import { PurchaseSatisfactionResponseDto } from './purchase-satisfaction-response.dto';

export class PurchaseSatisfactionSummaryDto {
  @ApiProperty() count: number;
  @ApiProperty({ description: '소수 1자리, 응답이 없으면 0' }) average: number;
  @ApiProperty({ description: '4점 이상 비율(정수 %)' }) csatPercent: number;
  @ApiProperty({ description: '3점 이하 중 미확인 건수' }) uncheckedLow: number;
  @ApiProperty({ type: [Number], description: '[1점, 2점, 3점, 4점, 5점]' }) distribution: number[];
  @ApiProperty({
    type: 'object',
    properties: Object.fromEntries(PURCHASE_SATISFACTION_REASONS.map((r) => [r, { type: 'number' }])),
  })
  reasonCounts: Record<PurchaseSatisfactionReason, number>;
}

export class AdminPurchaseSatisfactionListResponseDto {
  @ApiProperty({ type: PurchaseSatisfactionSummaryDto }) summary: PurchaseSatisfactionSummaryDto;
  @ApiProperty({ type: [PurchaseSatisfactionResponseDto] }) data: PurchaseSatisfactionResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
