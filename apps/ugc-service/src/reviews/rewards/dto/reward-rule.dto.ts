import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '@app/shared/dto';
import {
  BEST_SELECTION_MODES,
  BestSelectionMode,
  REVIEW_REWARD_KINDS,
  REVIEW_REWARD_PERIODS,
  REVIEW_REWARD_TRIGGERS,
  REVIEW_TYPE_FILTERS,
  ReviewRewardKind,
  ReviewRewardPeriod,
  ReviewRewardTrigger,
  ReviewTypeFilter,
} from '../reward-rule.types';

export class BestSpecDto {
  @ApiProperty({ enum: BEST_SELECTION_MODES, description: '선정 방식 — 추천수 순 또는 무작위 추첨' })
  @IsIn(BEST_SELECTION_MODES)
  mode: BestSelectionMode;

  @ApiProperty({ description: '주당 선정 인원', example: 3 })
  @IsInt()
  @Min(1)
  @Max(100)
  topN: number;

  @ApiProperty({ description: '후보가 되기 위한 최소 추천수', example: 1 })
  @IsInt()
  @Min(0)
  minHelpfulCount: number;
}

export class RewardConditionsDto {
  @ApiProperty({ enum: REVIEW_TYPE_FILTERS })
  @IsIn(REVIEW_TYPE_FILTERS)
  reviewType: ReviewTypeFilter;

  @ApiProperty({ description: '최소 글자수', example: 20 })
  @IsInt()
  @Min(0)
  minContentLength: number;

  @ApiProperty({ description: '최소 사진 수', example: 1 })
  @IsInt()
  @Min(0)
  minMediaCount: number;

  @ApiPropertyOptional({ description: '최소 별점. 비우면 별점 조건 없음' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  minRating: number | null;

  @ApiPropertyOptional({ description: 'N 번째 리뷰마다 지급. 비우면 매번' })
  @IsOptional()
  @IsInt()
  @Min(1)
  everyNthReview: number | null;

  @ApiPropertyOptional({ type: BestSpecDto, description: '주간 베스트 규칙에서만 사용' })
  @IsOptional()
  @ValidateNested()
  @Type(() => BestSpecDto)
  best: BestSpecDto | null;
}

export class RewardSpecDto {
  @ApiProperty({ enum: REVIEW_REWARD_KINDS, description: '보상 종류. NONE 이면 지급 없음' })
  @IsIn(REVIEW_REWARD_KINDS)
  kind: ReviewRewardKind;

  @ApiPropertyOptional({ description: '정액 지급액(원)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional({ description: '정률 지급 비율(%)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  ratePercent?: number;

  @ApiPropertyOptional({ description: '정률 지급 최소액(원)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  minAmount?: number | null;

  @ApiPropertyOptional({ description: '정률 지급 상한(원)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxAmount?: number | null;

  @ApiPropertyOptional({ description: '적립금 만료일수. 비우면 만료 없음' })
  @IsOptional()
  @IsInt()
  @Min(1)
  expiresInDays?: number | null;
}

export class RewardLimitSpecDto {
  @ApiProperty({ enum: REVIEW_REWARD_PERIODS })
  @IsIn(REVIEW_REWARD_PERIODS)
  period: ReviewRewardPeriod;

  @ApiPropertyOptional({ description: '기간당 최대 건수' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxCount: number | null;

  @ApiPropertyOptional({ description: '기간당 최대 금액(원)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxAmount: number | null;
}

export class RewardLimitsDto {
  @ApiPropertyOptional({ type: RewardLimitSpecDto, description: '1인당 한도' })
  @IsOptional()
  @ValidateNested()
  @Type(() => RewardLimitSpecDto)
  perUser: RewardLimitSpecDto | null;

  @ApiPropertyOptional({ type: RewardLimitSpecDto, description: '전체 예산 상한' })
  @IsOptional()
  @ValidateNested()
  @Type(() => RewardLimitSpecDto)
  global: RewardLimitSpecDto | null;
}

export class UpsertRewardRuleDto {
  @ApiProperty({ description: '규칙 이름', example: '포토리뷰 100원' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ description: '설명' })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiProperty({ enum: REVIEW_REWARD_TRIGGERS, description: '언제 평가되는 규칙인지' })
  @IsIn(REVIEW_REWARD_TRIGGERS)
  trigger: ReviewRewardTrigger;

  @ApiProperty({ description: '활성 여부. 기본은 비활성이다', example: false })
  @IsBoolean()
  active: boolean;

  @ApiProperty({ description: '우선순위 — 큰 값이 먼저 평가된다', example: 0 })
  @IsInt()
  priority: number;

  @ApiProperty({ description: '이 규칙이 매칭되면 뒤 규칙을 보지 않는다', example: true })
  @IsBoolean()
  stopOnMatch: boolean;

  @ApiProperty({ type: RewardConditionsDto })
  @ValidateNested()
  @Type(() => RewardConditionsDto)
  conditions: RewardConditionsDto;

  @ApiProperty({ type: RewardSpecDto })
  @ValidateNested()
  @Type(() => RewardSpecDto)
  reward: RewardSpecDto;

  @ApiProperty({ type: RewardLimitsDto })
  @ValidateNested()
  @Type(() => RewardLimitsDto)
  limits: RewardLimitsDto;

  @ApiPropertyOptional({ description: '적용 시작 시각(ISO8601)' })
  @IsOptional()
  @IsISO8601()
  startsAt?: string | null;

  @ApiPropertyOptional({ description: '적용 종료 시각(ISO8601)' })
  @IsOptional()
  @IsISO8601()
  endsAt?: string | null;
}

export class SetRuleActiveDto {
  @ApiProperty({ description: '활성 여부' })
  @IsBoolean()
  active: boolean;
}

export class RewardGrantListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['GRANTED', 'SKIPPED', 'REVOKED'] })
  @IsOptional()
  @IsIn(['GRANTED', 'SKIPPED', 'REVOKED'])
  status?: 'GRANTED' | 'SKIPPED' | 'REVOKED';

  @ApiPropertyOptional({ description: '회원 ID' })
  @IsOptional()
  @IsString()
  userId?: string;
}

export class BestSelectionListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['CANDIDATE', 'CONFIRMED', 'REJECTED'] })
  @IsOptional()
  @IsIn(['CANDIDATE', 'CONFIRMED', 'REJECTED'])
  status?: 'CANDIDATE' | 'CONFIRMED' | 'REJECTED';

  @ApiPropertyOptional({ description: '회차 시작 시각(ISO8601)' })
  @IsOptional()
  @IsISO8601()
  periodStart?: string;
}
