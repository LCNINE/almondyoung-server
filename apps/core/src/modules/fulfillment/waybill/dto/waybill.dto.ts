import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { carrierValues, CarrierEnum } from '../../../inventory/schema/enum-values';

export class IssueWaybillDto {
  @IsInt()
  @Min(1)
  expectedManifestVersion: number;

  @IsIn(carrierValues)
  carrier: CarrierEnum;
}

export class RegisterManualWaybillDto {
  @IsInt()
  @Min(1)
  expectedManifestVersion: number;

  @IsIn(carrierValues)
  carrier: CarrierEnum;

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
  reason: string;
}

export class AbandonWaybillDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class IssueBatchWaybillDto {
  @IsString({ each: true })
  shipmentIds: string[];

  @IsIn(carrierValues)
  carrier: CarrierEnum;
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
