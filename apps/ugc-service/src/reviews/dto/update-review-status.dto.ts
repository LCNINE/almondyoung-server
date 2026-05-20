import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { type ReviewStatus } from '../types';

export const REVIEW_STATUS_VALUES = ['active', 'hidden'] as const;

export class UpdateReviewStatusDto {
  @ApiProperty({
    description: '리뷰 상태',
    enum: REVIEW_STATUS_VALUES,
  })
  @IsIn(REVIEW_STATUS_VALUES)
  status: ReviewStatus;
}
