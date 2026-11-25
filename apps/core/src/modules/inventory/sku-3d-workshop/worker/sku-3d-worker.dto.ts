import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { Sku3dReviewVerdict } from '../../schema/inventory.schema';

const VERDICTS: Sku3dReviewVerdict[] = ['ready_for_review', 'needs_revision', 'needs_photos'];
const TEXT_LIST = { each: true } as const;

export class LeaseDto {
  @ApiProperty()
  @IsUUID()
  leaseToken!: string;
}

export class RecordSessionDto extends LeaseDto {
  @ApiProperty({ description: 'codex exec --json 의 thread.started 가 돌려준 id' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  sessionId!: string;
}

export class WorkerEventItemDto {
  @ApiProperty({ enum: ['progress', 'status'] })
  @IsIn(['progress', 'status'])
  type!: 'progress' | 'status';

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  body!: string;
}

export class AddWorkerEventsDto extends LeaseDto {
  @ApiProperty({ type: [WorkerEventItemDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => WorkerEventItemDto)
  items!: WorkerEventItemDto[];
}

export class ReviewIssueDto {
  @ApiProperty() @IsString() @MaxLength(300) where!: string;
  @ApiProperty() @IsString() @MaxLength(1000) observed!: string;
  @ApiProperty() @IsString() @MaxLength(1000) expected!: string;
  @ApiProperty({ enum: ['error', 'minor'] }) @IsIn(['error', 'minor']) severity!: 'error' | 'minor';
}

export class DimensionsUsedDto {
  @ApiProperty() @IsNumber() widthMm!: number;
  @ApiProperty() @IsNumber() lengthMm!: number;
  @ApiProperty() @IsNumber() heightMm!: number;
  @ApiProperty() @IsString() @MaxLength(64) basis!: string;
}

export class WorkerReviewDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(4000) summary!: string;
  @ApiProperty({ enum: VERDICTS }) @IsIn(VERDICTS) verdict!: Sku3dReviewVerdict;

  @ApiProperty({ type: [ReviewIssueDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ReviewIssueDto)
  issues!: ReviewIssueDto[];

  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(20) @IsString(TEXT_LIST) proposals!: string[];
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(20) @IsString(TEXT_LIST) autoFixes!: string[];
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(20) @IsString(TEXT_LIST) unseenFaces!: string[];
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(20) @IsString(TEXT_LIST) assumptions!: string[];
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(20) @IsString(TEXT_LIST) needsPhotos!: string[];

  @ApiProperty({ type: DimensionsUsedDto })
  @ValidateNested()
  @Type(() => DimensionsUsedDto)
  dimensionsUsed!: DimensionsUsedDto;
}

export class CompleteWorkerJobDto extends LeaseDto {
  @ApiProperty() @IsUUID() glbFileId!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(12)
  @IsUUID('all', TEXT_LIST)
  renderFileIds!: string[];

  @ApiPropertyOptional() @IsOptional() @IsUUID() pythonFileId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() blendFileId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() planFileId?: string;

  @ApiProperty({ type: WorkerReviewDto })
  @ValidateNested()
  @Type(() => WorkerReviewDto)
  review!: WorkerReviewDto;

  @ApiProperty({ description: '도구 버전·validator 결과 등', additionalProperties: true })
  @IsObject()
  provenance!: Record<string, unknown>;
}

export class FailWorkerJobDto extends LeaseDto {
  @ApiProperty() @IsString() @MaxLength(2000) error!: string;
  @ApiProperty() @IsBoolean() retryable!: boolean;
}
