import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator';
import { carrierEnum } from '../../../inventory/schema/inventory.schema';
import type { CarrierCode } from '../carrier/carrier-gateway.interface';

export class IssueWaybillDto {
  @IsInt()
  @Min(1)
  expectedManifestVersion: number;

  @IsIn(carrierEnum.enumValues)
  carrier: CarrierCode;
}

/** 재발급 — 발급과 같고, 지금 송장을 무효로 하는 사유를 작업 기록에 남긴다(사유 없이 오면 «송장 재발급»). */
export class ReissueWaybillDto extends IssueWaybillDto {
  @ApiPropertyOptional({ description: '기타를 고르면 직접 쓴 사유' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({ description: '사유 코드(shipment-operation-reasons 의 waybill_reissue)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  reasonCode?: string;

  @ApiPropertyOptional({ description: '고객 요청이면 요청 경로' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  requestChannel?: string;

  @ApiPropertyOptional({ description: '운영 메모' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class RegisterManualWaybillDto {
  @IsInt()
  @Min(1)
  expectedManifestVersion: number;

  @IsIn(carrierEnum.enumValues)
  carrier: CarrierCode;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  trackingNo: string;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class VoidWaybillDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;

  @ApiPropertyOptional({
    description: '사유 코드(shipment-operation-reasons 의 waybill_void). 없으면 사유 글만 남긴다',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  reasonCode?: string;

  @ApiPropertyOptional({ description: '고객 요청이면 요청 경로' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  requestChannel?: string;

  @ApiPropertyOptional({ description: '운영 메모' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class AbandonWaybillDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class IssueBatchWaybillDto {
  @IsString({ each: true })
  shipmentIds: string[];

  @IsIn(carrierEnum.enumValues)
  carrier: CarrierCode;
}

export class WaybillResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  shipmentId: string;

  @ApiProperty({ enum: ['carrier', 'manual'] })
  source: string;

  @ApiProperty()
  carrier: string;

  @ApiProperty()
  status: string;

  @ApiPropertyOptional({ nullable: true })
  trackingNo: string | null;

  @ApiPropertyOptional({ nullable: true })
  custOrdNo: string | null;

  @ApiProperty()
  manifestVersion: number;

  @ApiPropertyOptional({ nullable: true })
  issuedAt: string | null;

  @ApiPropertyOptional({ nullable: true })
  voidedAt: string | null;

  @ApiPropertyOptional({ nullable: true })
  lastError: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: '일시적 거절로 멈춘 경우 다음 재시도 시각. null 이면 대기 중이 아니다.',
  })
  nextAttemptAt: string | null;

  @ApiProperty({ description: '일시적 거절(한도·지역통제) 누적 횟수. attempts(결과 불명)와 별개다.' })
  transientAttempts: number;
}

export class BatchResultItemDto {
  @ApiProperty()
  shipmentId: string;

  @ApiProperty()
  status: string; // registered | failed | pending | allocated

  @ApiPropertyOptional({ nullable: true })
  trackingNo: string | null;

  @ApiPropertyOptional({ nullable: true })
  reason: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: '일시적 거절로 대기 중이면 다음 재시도 시각. pending 이 «시간예산 초과»인지 «대기»인지 가른다.',
  })
  nextAttemptAt: string | null;
}

export type WaybillActor = { id: string; roles: string[] };

export class WaybillLabelResponseDto {
  @ApiProperty()
  waybillId: string;

  @ApiProperty()
  trackingNo: string;

  @ApiProperty({ enum: ['zpl'] })
  format: 'zpl';

  @ApiProperty({ description: '프린터에 그대로 보낼 ZPL (ASCII)' })
  data: string;

  @ApiProperty({ description: '쪽 수 — data 안의 ^XA…^XZ 개수. 품목이 4줄을 넘는 FS 는 2 이상' })
  pages: number;

  @ApiProperty({
    description: '송장 내용 지문(64자 hex). 인쇄 성공 뒤 POST shipments/:id/waybill/label-prints 에 그대로 보낸다',
  })
  fingerprint: string;

  @ApiProperty({ description: '판차. 2 이상이면 종이에 「N판」 이 찍힌다' })
  revision: number;
}

export class ConfirmLabelPrintDto {
  @ApiProperty({ description: '렌더 응답의 fingerprint 그대로' })
  @IsString()
  @Length(64, 64)
  fingerprint: string;
}

export class LabelPrintConfirmationDto {
  @ApiProperty() fingerprint: string;
  @ApiProperty() revision: number;
  @ApiProperty() printedAt: string;
}
