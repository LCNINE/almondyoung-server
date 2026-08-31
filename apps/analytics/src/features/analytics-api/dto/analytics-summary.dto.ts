import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DailyRevenueSummaryDto {
  @ApiProperty({ example: '2026-08-24', description: 'KST 달력 날짜' })
  date: string;

  @ApiProperty({ example: 0, description: '총매출 (취소·환불 미차감)' })
  grossRevenue: number;

  @ApiProperty({ example: 0, description: '그날 발생한 취소 금액 (취소일 귀속)' })
  cancelledAmount: number;

  @ApiProperty({ example: 0, description: '그날 발생한 환불 금액' })
  refundedAmount: number;

  @ApiProperty({ example: 0, description: '순매출 = 총매출 - 취소 - 환불. 음수 가능' })
  netRevenue: number;

  @ApiProperty({ example: 0 })
  ordersCount: number;

  @ApiPropertyOptional({ nullable: true, description: '객단가 = 순매출/주문수. 주문 0이면 null' })
  avgOrderValue: number | null;
}

export class AnalyticsSummaryDto {
  @ApiProperty({ type: DailyRevenueSummaryDto })
  today: DailyRevenueSummaryDto;

  @ApiProperty({ type: DailyRevenueSummaryDto })
  yesterday: DailyRevenueSummaryDto;

  @ApiPropertyOptional({ nullable: true, description: '최근 스냅샷 기준 활성 멤버십 회원 수. 스냅샷이 없으면 null' })
  activeMembers: number | null;

  @ApiPropertyOptional({ nullable: true, description: '위 값의 스냅샷 날짜 (KST)' })
  activeMembersAsOf: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: '2026-08-28T01:00:00.000Z',
    description: '매출 집계가 마지막으로 갱신된 순간(UTC ISO). 화면은 이걸 KST 로 바꿔 "언제 기준"을 표기한다.',
  })
  dataAsOf: string | null;
}
