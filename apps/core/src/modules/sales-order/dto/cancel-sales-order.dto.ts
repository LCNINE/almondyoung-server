import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class CancelSalesOrderLineDto {
  @ApiProperty({ description: '부분 취소할 SalesOrder line ID' })
  @IsString()
  salesOrderLineId: string;

  @ApiProperty({ description: '부분 취소할 판매주문 line 수량', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}

export class CancelSalesOrderWalletRefundDto {
  @ApiProperty({ description: 'Wallet refund 내부 ID. UUID일 때만 사용한다.', required: false })
  @IsString()
  @IsOptional()
  id?: string;

  @ApiProperty({ description: 'Wallet refund 안정 외부 참조값', required: false, example: 'wallet:refund:rf_123' })
  @IsString()
  @IsOptional()
  externalRef?: string;

  @ApiProperty({ description: '환불 금액', required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  amount?: number;

  @ApiProperty({ description: '통화', required: false, example: 'KRW' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiProperty({ description: 'Wallet 소유 환불 상태', required: false, example: 'PENDING' })
  @IsString()
  @IsOptional()
  refundStatus?: string;

  @ApiProperty({ description: 'Wallet refund 연결 메타데이터', required: false })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class CancelSalesOrderPostShipmentHandoffDto {
  @ApiProperty({
    description: '출고 후 취소 수량을 넘길 후속 정책/workflow 종류',
    enum: ['return', 'recovery', 'refund', 'compensation'],
    required: false,
    default: 'recovery',
  })
  @IsString()
  @IsIn(['return', 'recovery', 'refund', 'compensation'])
  @IsOptional()
  type?: 'return' | 'recovery' | 'refund' | 'compensation';

  @ApiProperty({ description: '후속 workflow 내부 ID. UUID일 때만 사용한다.', required: false })
  @IsString()
  @IsUUID()
  @IsOptional()
  id?: string;

  @ApiProperty({
    description: '후속 workflow 안정 외부 참조값',
    required: false,
    example: 'return:request:ret_123',
  })
  @IsString()
  @IsOptional()
  externalRef?: string;

  @ApiProperty({
    description: '후속 workflow 소유 도메인의 상태 스냅샷. 예: requested, pending_policy_decision',
    required: false,
  })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiProperty({ description: '후속 workflow 연결 메타데이터', required: false })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class CancelSalesOrderDto {
  @ApiProperty({
    description: '부분 취소 line/quantity 범위. 생략하면 전체 취소로 처리한다.',
    required: false,
    type: [CancelSalesOrderLineDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CancelSalesOrderLineDto)
  @IsOptional()
  lines?: CancelSalesOrderLineDto[];

  @ApiProperty({
    description: '부분/전체 취소와 연결할 Wallet refund 효과. Core는 참조와 상태 스냅샷만 저장한다.',
    required: false,
    type: CancelSalesOrderWalletRefundDto,
  })
  @ValidateNested()
  @Type(() => CancelSalesOrderWalletRefundDto)
  @IsOptional()
  walletRefund?: CancelSalesOrderWalletRefundDto;

  @ApiProperty({
    description: '출고된 수량에 대한 반품/회수/환불정책/보상 handoff. Core는 참조와 상태 스냅샷만 저장한다.',
    required: false,
    type: CancelSalesOrderPostShipmentHandoffDto,
  })
  @ValidateNested()
  @Type(() => CancelSalesOrderPostShipmentHandoffDto)
  @IsOptional()
  postShipmentHandoff?: CancelSalesOrderPostShipmentHandoffDto;

  @ApiProperty({
    description: '취소 사유 코드',
    required: false,
    example: 'CUSTOMER_REQUEST',
  })
  @IsString()
  @IsOptional()
  reasonCode?: string;

  @ApiProperty({ description: '취소 사유 상세', required: false })
  @IsString()
  @IsOptional()
  reasonDetail?: string;

  @ApiProperty({ description: '취소 주체', required: false, example: 'admin' })
  @IsString()
  @IsOptional()
  cancelledBy?: string;

  @ApiProperty({ description: '취소 발생 시각', required: false, type: String, format: 'date-time' })
  @IsDateString()
  @IsOptional()
  occurredAt?: string;

  @ApiProperty({ description: '취소 메타데이터', required: false })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
