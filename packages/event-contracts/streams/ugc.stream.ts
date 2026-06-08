/**
 * UGC Domain Stream Configuration
 *
 * Commands (ugc.commands.v1): wallet이 소비하는 리워드 적립 명령
 * Events   (ugc.events.v1):   search 등 downstream이 구독하는 도메인 이벤트
 */

import { event, stream } from '../types';
import { z } from 'zod';

// ===== Command Payloads =====

export interface EarnPointsRequestedPayload {
  reviewId: string;
  userId: string;
  reviewType: 'TEXT' | 'PHOTO';
  amount: number;
  reasonCode: string;
  productId: string;
  requestedAt: string;
}

// ===== Event Payloads =====

/**
 * rating 키는 JSON 직렬화 시 문자열이므로 string literal union으로 정의.
 * 분포 합계가 reviewCount와 다를 수 있음 (상태 전이 중 일시적 불일치 허용).
 */
export interface RatingDistribution {
  '1': number;
  '2': number;
  '3': number;
  '4': number;
  '5': number;
}

/**
 * 상품 리뷰 통계 변경 이벤트.
 *
 * ugc-service가 리뷰 생성/수정/삭제/숨김/공개 모든 경로에서 발행.
 * 집계 결과 이벤트이므로 멱등: 동일 payload 재처리 시 search 문서는 동일 값으로 수렴.
 *
 * productId = ugc reviews.product_id = search master_id (UUID).
 * bayesianReviewScore 계산: (C * m + n * avg) / (C + n), C=10, m=3.5.
 */
export interface ProductReviewStatsChangedPayload {
  productId: string;
  reviewCount: number;
  ratingSum: number;
  averageRating: number;
  bayesianReviewScore: number;
  ratingDistribution: RatingDistribution;
  changedAt: string;
}

// ===== Zod Schemas =====

const EarnPointsRequestedSchema = z.object({
  reviewId: z.string().uuid(),
  userId: z.string().uuid(),
  reviewType: z.enum(['TEXT', 'PHOTO']),
  amount: z.number().int().positive(),
  reasonCode: z.string().min(1),
  productId: z.string().uuid(),
  requestedAt: z.string().datetime(),
});

const RatingDistributionSchema = z.object({
  '1': z.number().int().nonnegative(),
  '2': z.number().int().nonnegative(),
  '3': z.number().int().nonnegative(),
  '4': z.number().int().nonnegative(),
  '5': z.number().int().nonnegative(),
});

const ProductReviewStatsChangedSchema = z.object({
  productId: z.string().uuid(),
  reviewCount: z.number().int().nonnegative(),
  ratingSum: z.number().int().nonnegative(),
  averageRating: z.number().min(0).max(5),
  bayesianReviewScore: z.number().min(0).max(5),
  ratingDistribution: RatingDistributionSchema,
  changedAt: z.string().datetime(),
});

// ===== Stream Config =====

export const UGC_COMMAND_STREAM = stream({
  topic: 'ugc.commands.v1',
  partitions: 3,
  aggregateType: 'UGC',
  events: {
    EarnPointsRequested: event<'EarnPointsRequested', EarnPointsRequestedPayload>(
      'EarnPointsRequested',
      EarnPointsRequestedSchema,
    ),
  },
});

/**
 * UGC domain event stream.
 * aggregateType 'UgcProduct'은 core/channel-adapter의 'Product' aggregate와 구별.
 * partition key = productId → 동일 상품의 통계 이벤트는 순서 보장.
 */
export const UGC_EVENT_STREAM = stream({
  topic: 'ugc.events.v1',
  partitions: 3,
  aggregateType: 'UgcProduct',
  events: {
    ProductReviewStatsChanged: event<
      'ProductReviewStatsChanged',
      ProductReviewStatsChangedPayload
    >('ProductReviewStatsChanged', ProductReviewStatsChangedSchema),
  },
});

export type UgcCommandEvents = typeof UGC_COMMAND_STREAM.events;
export type UgcDomainEvents = typeof UGC_EVENT_STREAM.events;
