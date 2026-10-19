import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const ACTIONS = ['view', 'reveal', 'export'] as const;
type Action = (typeof ACTIONS)[number];

export class PiiAccessLogsQueryDto {
  @ApiPropertyOptional({ description: '이 시각 이후(포함)' }) @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional({ description: '이 시각 이전(제외)' }) @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() actorUserId?: string;
  @ApiPropertyOptional({ enum: ACTIONS }) @IsOptional() @IsIn([...ACTIONS]) action?: Action;
  @ApiPropertyOptional({ description: '대상 종류(user·sales_order …)' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  subjectType?: string;
  @ApiPropertyOptional({ description: '대상 식별자 — subjectType 과 함께' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subjectId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) cursor?: string;
  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class PiiAccessSubjectDto {
  @ApiProperty() @IsString() @Length(1, 40) type!: string;
  @ApiProperty() @IsString() @Length(1, 200) id!: string;
}

export class PiiAccessLogDto {
  @ApiProperty() id!: string;
  @ApiProperty() eventId!: string;
  @ApiProperty() occurredAt!: Date;
  @ApiProperty() actorUserId!: string;
  @ApiProperty({ nullable: true, type: String }) actorLoginId!: string | null;
  @ApiProperty({ nullable: true, type: String, description: '관리자 화면 프록시가 넘긴 직원 단말 주소' }) claimedIp!: string | null;
  @ApiProperty({ nullable: true, type: String, description: '서비스가 본 연결 주소' }) peerIp!: string | null;
  @ApiProperty({ nullable: true, type: String }) forwardedFor!: string | null;
  @ApiProperty({ nullable: true, type: String }) userAgent!: string | null;
  @ApiProperty({ nullable: true, type: String }) requestId!: string | null;
  @ApiProperty() sourceService!: string;
  @ApiProperty() method!: string;
  @ApiProperty() route!: string;
  @ApiProperty({ enum: ACTIONS }) action!: string;
  @ApiProperty({ description: '대상 식별자(최대 1,000개)' }) subjects!: unknown;
  @ApiProperty({ description: '실제 대상 수' }) subjectCount!: number;
  @ApiProperty({ type: [String] }) kinds!: string[];
  @ApiProperty({ type: [String], description: '쿼리 키(값은 남기지 않는다)' }) queryKeys!: string[];
  @ApiProperty({ nullable: true, type: String }) reason!: string | null;
  @ApiProperty() recordedAt!: Date;
}

export class PiiAccessPageDto {
  @ApiProperty({ type: [PiiAccessLogDto] }) items!: PiiAccessLogDto[];
  @ApiProperty({ nullable: true, type: String }) nextCursor!: string | null;
}

export class PiiAccessSummaryQueryDto {
  @ApiProperty({ description: '이 시각 이후(포함)' }) @IsISO8601() from!: string;
  @ApiProperty({ description: '이 시각 이전(제외)' }) @IsISO8601() to!: string;
}

export class PiiAccessActorSummaryDto {
  @ApiProperty() actorUserId!: string;
  @ApiProperty({ nullable: true, type: String }) actorLoginId!: string | null;
  @ApiProperty() accessCount!: number;
  @ApiProperty() subjectTotal!: number;
  @ApiProperty() exportCount!: number;
  @ApiProperty({ description: '한국 시각 09~19시 밖' }) afterHoursCount!: number;
}

export class PiiAccessSummaryDto {
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty({ type: [PiiAccessActorSummaryDto] }) actors!: PiiAccessActorSummaryDto[];
}

export class CreatePiiAccessReviewDto {
  @ApiProperty({ description: '점검 기간 이름(예: 2026-10)' }) @IsString() @Length(1, 40) period!: string;
  @ApiProperty() @IsISO8601() rangeFrom!: string;
  @ApiProperty() @IsISO8601() rangeTo!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class PiiAccessReviewDto {
  @ApiProperty() id!: string;
  @ApiProperty() period!: string;
  @ApiProperty() rangeFrom!: Date;
  @ApiProperty() rangeTo!: Date;
  @ApiProperty() reviewedBy!: string;
  @ApiProperty({ nullable: true, type: String }) reviewedByLoginId!: string | null;
  @ApiProperty() reviewedAt!: Date;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
}

/** 관리자 화면 프록시가 직원 본인 토큰으로 보내는 기록. 행위자는 토큰에서 정한다. */
export class OwnPiiAccessRecordDto {
  @ApiProperty() @IsUUID() eventId!: string;
  @ApiProperty() @IsString() @Length(1, 40) sourceService!: string;
  @ApiProperty() @IsString() @Length(1, 10) method!: string;
  @ApiProperty() @IsString() @Length(1, 500) route!: string;
  @ApiProperty({ enum: ACTIONS }) @IsIn([...ACTIONS]) action!: Action;
  @ApiProperty({ type: [PiiAccessSubjectDto] })
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => PiiAccessSubjectDto)
  subjects!: PiiAccessSubjectDto[];
  @ApiProperty() @IsInt() @Min(0) subjectCount!: number;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) kinds!: string[];
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) queryKeys!: string[];
  @ApiPropertyOptional({ nullable: true, type: String }) @IsOptional() @IsString() @MaxLength(200) reason!: string | null;
  @ApiProperty() @IsISO8601() occurredAt!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) @IsOptional() @IsString() @MaxLength(45) claimedIp!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) @IsOptional() @IsString() @MaxLength(500) forwardedFor!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) @IsOptional() @IsString() @MaxLength(45) peerIp!: string | null;
}

/** 아웃박스가 없는 서비스(notification)가 내부 키로 보내는 기록 — 행위자를 보낸 쪽이 정한다. */
export class InternalPiiAccessRecordDto extends OwnPiiAccessRecordDto {
  @ApiProperty() @IsUUID() actorUserId!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) @IsOptional() @IsString() @MaxLength(30) actorLoginId!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) @IsOptional() @IsString() @MaxLength(500) userAgent!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) @IsOptional() @IsString() @MaxLength(100) requestId!: string | null;
}
