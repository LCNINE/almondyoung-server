import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export type StoreOrderAction = 'cancel' | 'track' | 'return' | 'exchange' | 'receipt';

export type StoreFulfillmentStatus =
  | 'not_created'
  | 'awaiting_matching'
  | 'created'
  | 'picking'
  | 'packed'
  | 'shipped'
  | 'delivered'
  | 'canceled';

export type StoreRefundStatus = 'none' | 'pending' | 'manual_pending' | 'succeeded' | 'failed';

export type StoreCancelUnavailableReason =
  | 'already_shipped'
  | 'already_cancelled'
  | 'channel_order'
  | 'already_processing';

export type StoreClaimStatus =
  | 'none'
  | 'return_requested'
  | 'exchange_requested'
  | 'returning'
  | 'completed';

/**
 * 고객에게 노출할 환불 요약 정보.
 *
 * Core가 Wallet 상태와 businessLinks를 조합해 생성한다.
 * 내부 에러 코드, provider raw error, PG transaction key 등 운영 민감 정보는 포함하지 않는다.
 */
export class RefundSummaryDto {
  @ApiProperty({ enum: ['none', 'pending', 'manual_pending', 'succeeded', 'failed'] })
  status: StoreRefundStatus;

  @ApiPropertyOptional({ description: '환불 금액 (KRW 기준 원 단위)' })
  amount: number | null;

  @ApiProperty()
  currency: string;

  @ApiPropertyOptional({ description: '결제 수단 표시 레이블 (예: 신용카드, 카카오페이)' })
  paymentMethodLabel: string | null;

  @ApiProperty({ description: '수동 처리가 필요한 경우 true' })
  manualRequired: boolean;

  @ApiPropertyOptional({ description: '고객 안내 메시지 (상태별 템플릿 문구)' })
  expectedProcessingMessage: string | null;

  @ApiPropertyOptional()
  lastUpdatedAt: string | null;
}

export class StoreOrderActionsResponseDto {
  @ApiProperty()
  orderId: string;

  @ApiProperty()
  channelOrderId: string;

  @ApiProperty({ enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'timeout'] })
  orderStatus: string;

  @ApiProperty({
    enum: ['not_created', 'awaiting_matching', 'created', 'picking', 'packed', 'shipped', 'delivered', 'canceled'],
  })
  fulfillmentStatus: StoreFulfillmentStatus;

  @ApiProperty({ enum: ['none', 'pending', 'manual_pending', 'succeeded', 'failed'] })
  refundStatus: StoreRefundStatus;

  @ApiPropertyOptional({ type: RefundSummaryDto, description: '환불 상세 요약 (취소/부분취소 주문에서 제공)' })
  refundSummary?: RefundSummaryDto;

  @ApiProperty({ enum: ['cancel', 'track', 'return', 'exchange', 'receipt'], isArray: true })
  availableActions: StoreOrderAction[];

  @ApiProperty({ enum: ['none', 'return_requested', 'exchange_requested', 'returning', 'completed'] })
  claimStatus: StoreClaimStatus;

  @ApiPropertyOptional({
    enum: ['already_shipped', 'already_cancelled', 'channel_order', 'already_processing'],
  })
  cancelUnavailableReason?: StoreCancelUnavailableReason;

  /**
   * 결제 상태. 현재는 결제확인된 주문만 WMS로 수집되므로 항상 'paid'.
   * 무통장입금 도입 시 Wallet intent 상태를 조회해 'awaiting_payment'로 분기한다.
   */
  @ApiPropertyOptional({ enum: ['paid', 'awaiting_payment'] })
  paymentStatus?: 'paid' | 'awaiting_payment';

  @ApiPropertyOptional()
  channelInfo?: {
    channel: string;
    cancelUrl?: string;
    returnUrl?: string;
  };
}

export class StoreCancelOrderDto {
  @ApiPropertyOptional({
    description: '취소 사유 코드',
    enum: ['CHANGE_OF_MIND', 'WRONG_ORDER', 'FOUND_CHEAPER', 'DELAY', 'OTHER'],
    example: 'CHANGE_OF_MIND',
  })
  @IsString()
  @IsIn(['CHANGE_OF_MIND', 'WRONG_ORDER', 'FOUND_CHEAPER', 'DELAY', 'OTHER'])
  @IsOptional()
  reasonCode?: string;

  @ApiPropertyOptional({ description: '취소 사유 상세', maxLength: 500 })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  reasonDetail?: string;
}
