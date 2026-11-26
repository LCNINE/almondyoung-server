import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { OperationVerdict } from '../operation-verdict';

export class ReportedOperationDto {
  @ApiProperty({ description: '기기가 그 쓰기에 붙인 요청 키' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  operationKey!: string;

  @ApiProperty({ example: 'POST' })
  @IsString()
  @MaxLength(10)
  method!: string;

  @ApiProperty({ example: '/inbound/simple' })
  @IsString()
  @MaxLength(500)
  path!: string;

  @ApiProperty({ description: '작업 이름', example: '입고' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  workName!: string;

  @ApiPropertyOptional({ description: '대상(상품·수량)', example: '데모 상품 11 ×3' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  summary?: string;

  @ApiProperty({ description: '기기 기록의 상태', example: 'uncertain' })
  @IsString()
  @MaxLength(16)
  status!: string;

  @ApiProperty({ example: 4 })
  @IsInt()
  @Min(0)
  attempts!: number;

  @ApiPropertyOptional({ example: 'FORBIDDEN' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  errorCode?: string;

  @ApiProperty({ description: '기기 시계로 그 작업을 처음 기록한 시각' })
  @IsDateString()
  recordedAt!: string;
}

export class ReportUnresolvedOperationsDto {
  @ApiProperty({
    description:
      '이 기기의 보고 번호 — 뒤에 보낸 보고일수록 크다. 더 작거나 같은 번호는 늦게 온 옛 보고로 보고 무시한다',
  })
  @IsInt()
  @Min(0)
  reportSeq!: number;

  @ApiProperty({ enum: ['station', 'handheld'] })
  @IsIn(['station', 'handheld'])
  deviceKind!: 'station' | 'handheld';

  @ApiPropertyOptional({ description: '기기에 로그인한 작업자 이름(표시용)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  workerName?: string;

  @ApiProperty({ type: [ReportedOperationDto], description: '지금 이 기기·이 작업자에게 남은 결과 모름 전부' })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReportedOperationDto)
  operations!: ReportedOperationDto[];
}

export class ReportUnresolvedOperationsResponseDto {
  @ApiProperty({ type: [String], description: '서버에서 결과가 정해진 키 — 기기가 같은 키로 다시 확인하면 끝난다' })
  decided!: string[];
}

export class ResolveDeviceWorkDto {
  @ApiProperty({
    enum: ['abandon', 'dismiss'],
    description:
      'abandon: 반영되지 않은 작업을 버린다(그 키는 다시 반영되지 않는다) · dismiss: 결과가 정해진 작업을 목록에서 뺀다',
  })
  @IsIn(['abandon', 'dismiss'])
  action!: 'abandon' | 'dismiss';
}

export class DeviceWorkRowDto {
  @ApiProperty() operationKey!: string;
  @ApiProperty() deviceId!: string;
  @ApiProperty({ enum: ['station', 'handheld'] }) deviceKind!: 'station' | 'handheld';
  @ApiPropertyOptional({ type: String, nullable: true }) workerName!: string | null;
  @ApiProperty() workName!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) summary!: string | null;
  @ApiProperty() path!: string;
  @ApiProperty() deviceStatus!: string;
  @ApiProperty() attempts!: number;
  @ApiPropertyOptional({ type: String, nullable: true }) errorCode!: string | null;
  @ApiProperty() recordedAt!: string;
  @ApiProperty() lastReportedAt!: string;
  @ApiProperty({ enum: ['applied', 'rejected', 'abandoned', 'in_progress', 'not_applied', 'expired'] })
  verdict!: OperationVerdict;
}

export class DeviceWorkListDto {
  @ApiProperty({ type: [DeviceWorkRowDto] })
  items!: DeviceWorkRowDto[];
}

export class ResolveDeviceWorkResponseDto {
  @ApiProperty() operationKey!: string;
  @ApiProperty({ enum: ['abandoned', 'dismissed'] }) resolution!: 'abandoned' | 'dismissed';
}
