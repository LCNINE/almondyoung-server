import { ApiProperty } from '@nestjs/swagger';
import { IsCalendarDateConstraint } from '@app/shared';
import { IsNotEmpty, IsString, Validate } from 'class-validator';

export class ItemBehaviorQueryDto {
  @ApiProperty({ example: '2026-08-01', description: '조회 시작일 (GA4 속성 시간대 기준, 포함)' })
  @Validate(IsCalendarDateConstraint, { message: 'from 은 달력에 존재하는 YYYY-MM-DD 여야 합니다' })
  from: string;

  @ApiProperty({ example: '2026-08-24', description: '조회 종료일 (GA4 속성 시간대 기준, 포함)' })
  @Validate(IsCalendarDateConstraint, { message: 'to 는 달력에 존재하는 YYYY-MM-DD 여야 합니다' })
  to: string;

  @ApiProperty({
    description: 'GA4 item_id — 스토어프론트가 보내는 값은 Medusa product id 다 (PIM masterId 아님)',
    example: 'prod_01J0000000000000000000',
  })
  @IsString()
  @IsNotEmpty({ message: 'itemId 는 필수입니다' })
  itemId: string;
}

export class SingleItemBehaviorDto {
  itemId: string;
  /** GA4 가 기록한 상품명 — 개명 이력에 따라 우리 상품명과 다를 수 있다 */
  name: string | null;
  viewed: number;
  addedToCart: number;
  purchased: number;
  revenue: number;
  /** 담기율 = 담기 ÷ 조회. 조회 0 이면 null */
  cartRate: number | null;
  /** 구매 전환율 = 구매 ÷ 담기. 담기 0 이면 null (행동 탭 표의 '구매율'은 분모가 조회다 — 다른 값) */
  purchaseRate: number | null;
}

/** 전 상품 합계 — 상품 행과 같은 아이템 지표라 비교 기준의 분모가 맞는다. */
export class ItemBehaviorTotalsDto {
  viewed: number;
  addedToCart: number;
  purchased: number;
  cartRate: number | null;
  purchaseRate: number | null;
}

export class ItemBehaviorResponseDto {
  /** false 면 GA4 env 미배선 — 화면은 "연동 대기"를 보여준다 */
  enabled: boolean;
  range: { from: string; to: string };
  itemId: string;
  /** null = 기간 내 이 상품의 아이템 이벤트가 없음 */
  item: SingleItemBehaviorDto | null;
  /** GA4 미배선이면 null */
  totals: ItemBehaviorTotalsDto | null;
}
