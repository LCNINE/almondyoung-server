import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { CARRIER_ATTENTION_KINDS, type CarrierAttentionKind } from '../carrier-tracking.judge';

export class CarrierTrackingOrderDto {
  @ApiProperty() salesOrderId!: string;
  @ApiProperty() orderNo!: string;
  @ApiProperty({ description: '주문내역 지목 검색에 쓰는 번호' }) channelOrderId!: string;
}

export class CarrierTrackingScanDto {
  @ApiProperty() code!: string;
  @ApiProperty() status!: string;
  @ApiProperty() at!: string;
  @ApiProperty({ nullable: true, type: String }) location!: string | null;
  @ApiProperty({ nullable: true, type: String }) reason!: string | null;
}

export class CarrierTrackingConfirmationDto {
  @ApiProperty() id!: string;
  @ApiProperty() kind!: string;
  @ApiProperty({ enum: ['wait', 'closed'] }) outcome!: 'wait' | 'closed';
  @ApiProperty({ nullable: true, type: String, description: '이때까지 내려 둔다. 끝남이면 null' })
  resumeAt!: string | null;
  @ApiProperty() note!: string;
  @ApiProperty() actorId!: string;
  @ApiProperty() createdAt!: string;
}

export class CarrierTrackingItemDto {
  @ApiProperty() dispatchAttemptId!: string;
  @ApiProperty() attemptNo!: number;
  @ApiProperty() shipmentId!: string;
  @ApiProperty() carrier!: string;
  @ApiProperty() trackingNo!: string;
  @ApiProperty({ type: [CarrierTrackingOrderDto] }) orders!: CarrierTrackingOrderDto[];
  @ApiProperty({ enum: CARRIER_ATTENTION_KINDS, nullable: true }) kind!: CarrierAttentionKind | null;
  @ApiProperty({ description: '지금 사람이 확인할 일' }) raised!: boolean;
  @ApiProperty({ description: '택배사가 받은 것으로 확인됨' }) accepted!: boolean;
  @ApiProperty() recalled!: boolean;
  @ApiProperty() dispatchedAt!: string;
  @ApiProperty({ description: '집하 스캔이 이때까지 없으면 확인할 일이 된다' }) dueAt!: string;
  @ApiProperty({ nullable: true, type: String, description: '마지막으로 물은 시각' }) attemptedAt!: string | null;
  @ApiProperty({ nullable: true, type: String, description: '택배사가 마지막으로 답한 시각' })
  answeredAt!: string | null;
  @ApiProperty({ enum: ['scans', 'no_scan', 'rejected', 'unknown'], nullable: true }) lastOutcome!: string | null;
  @ApiProperty({ nullable: true, type: CarrierTrackingScanDto }) scan!: CarrierTrackingScanDto | null;
  @ApiProperty({ description: '확인 기록을 남길 때 그대로 보낸다' }) scanKey!: string;
  @ApiProperty({ type: [CarrierTrackingConfirmationDto], description: '확인 이력, 최근 것부터' })
  confirmations!: CarrierTrackingConfirmationDto[];
}

export class CarrierTrackingPollingDto {
  @ApiProperty({ nullable: true, type: String }) lastAnsweredAt!: string | null;
  @ApiProperty({ description: '물어야 할 송장이 있는데 택배사가 답하지 않고 있다' }) failing!: boolean;
}

export class CarrierTrackingSummaryDto {
  @ApiProperty({ description: '지금 확인할 송장 수' }) attention!: number;
  @ApiProperty({ type: CarrierTrackingPollingDto }) polling!: CarrierTrackingPollingDto;
}

export class CarrierTrackingAttentionDto extends CarrierTrackingSummaryDto {
  @ApiProperty({ description: '확인 기록으로 내려 둔 송장 수' }) waiting!: number;
  @ApiProperty({ type: [CarrierTrackingItemDto], description: '확인할 것부터, 내려 둔 것이 뒤. 끝남은 싣지 않는다' })
  items!: CarrierTrackingItemDto[];
}

export class CarrierTrackingShipmentDto {
  @ApiProperty({ type: [CarrierTrackingItemDto] }) items!: CarrierTrackingItemDto[];
}

export class ConfirmCarrierTrackingDto {
  @ApiProperty({ enum: ['wait', 'closed'], description: 'wait = 다음 영업일까지 내려 둠, closed = 더 볼 일 없음' })
  @IsIn(['wait', 'closed'])
  outcome!: 'wait' | 'closed';

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  note!: string;

  @ApiProperty({ enum: CARRIER_ATTENTION_KINDS })
  @IsIn(CARRIER_ATTENTION_KINDS)
  expectedKind!: CarrierAttentionKind;

  @ApiProperty()
  @IsString()
  @MaxLength(64)
  expectedScanKey!: string;

  @ApiPropertyOptional({ nullable: true, type: String, description: '화면이 본 마지막 확인 기록' })
  @IsOptional()
  @IsUUID()
  expectedConfirmationId?: string | null;
}

export class CarrierTrackingConfirmResultDto {
  @ApiProperty() confirmationId!: string;
  @ApiProperty({ nullable: true, type: String }) resumeAt!: string | null;
}
