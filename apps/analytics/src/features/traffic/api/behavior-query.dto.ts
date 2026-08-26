import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsCalendarDateConstraint } from '@app/shared';
import { Type } from 'class-transformer';
import { IsInt, Max, Min, IsOptional, Validate } from 'class-validator';

export class BehaviorStatisticsQueryDto {
  @ApiProperty({ example: '2026-08-01', description: '조회 시작일 (GA4 속성 시간대 기준, 포함)' })
  @Validate(IsCalendarDateConstraint, { message: 'from 은 달력에 존재하는 YYYY-MM-DD 여야 합니다' })
  from: string;

  @ApiProperty({ example: '2026-08-24', description: '조회 종료일 (GA4 속성 시간대 기준, 포함)' })
  @Validate(IsCalendarDateConstraint, { message: 'to 는 달력에 존재하는 YYYY-MM-DD 여야 합니다' })
  to: string;

  @ApiPropertyOptional({ example: 20, default: 20, description: '상품별 행동 목록 최대 행 수' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}

export class BehaviorTotalsDto {
  sessions: number;
  totalUsers: number;
  /** 상품 상세 조회(view_item) 이벤트 수 */
  viewItem: number;
  /** 장바구니 담기(add_to_cart) 이벤트 수 */
  addToCart: number;
  /** 체크아웃 진입(begin_checkout) 이벤트 수 */
  beginCheckout: number;
  /** 결제창 이동(add_payment_info) 이벤트 수 */
  addPaymentInfo: number;
  /** 구매 완료(purchase) 이벤트 수 */
  purchase: number;
}

export class BehaviorDailyBucketDto {
  /** GA4 속성 시간대의 달력 날짜 (YYYY-MM-DD) */
  date: string;
  sessions: number;
  viewItem: number;
  addToCart: number;
  purchase: number;
  /** 구매 ÷ 세션. 세션 0 이면 null */
  conversionRate: number | null;
}

export class ItemBehaviorRowDto {
  name: string;
  viewed: number;
  addedToCart: number;
  purchased: number;
  revenue: number;
  /** 담기 ÷ 조회. 조회 0 이면 null */
  cartRate: number | null;
  /** 구매 ÷ 조회. 조회 0 이면 null */
  purchaseRate: number | null;
}

export class DeviceFunnelRowDto {
  device: string;
  viewItem: number;
  addToCart: number;
  purchase: number;
  /** 구매 ÷ 상품조회. 조회 0 이면 null */
  conversionRate: number | null;
}

export class BehaviorStatisticsResponseDto {
  /** false 면 GA4 env 미배선 — 화면은 "연동 대기"를 보여준다 */
  enabled: boolean;
  range: { from: string; to: string };
  totals: BehaviorTotalsDto | null;
  series: BehaviorDailyBucketDto[];
  items: ItemBehaviorRowDto[];
  devices: DeviceFunnelRowDto[];
}
