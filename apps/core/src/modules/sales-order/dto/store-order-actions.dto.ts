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
