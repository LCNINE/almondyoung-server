// types.ts - 리팩토링된 타입 정의

import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';

import * as schema from './entities/schema';

// ====== Drizzle 스키마 기반 엔티티 타입 ======
export type User = InferSelectModel<typeof schema.users>;
export type NewUser = InferInsertModel<typeof schema.users>;

export type PauseUsageTracker = InferSelectModel<
  typeof schema.pauseUsageTracker
>;
export type NewPauseUsageTracker = InferInsertModel<
  typeof schema.pauseUsageTracker
>;

// ====== Service Layer Input Types ======

// ====== API Response Types ======

// ====== 특화된 정책 검증 타입 ======

/**
 * 일시정지 정책 검증 결과
 */

/**
 * 구독 재개 정책 검증 결과
 */

// =================================================================
// 정책 엔진 관련 타입들 (PolicyEngineService용)
// =================================================================

/**
 * 정책 엔진에서 사용하는 Policy 타입
 * SubscriptionPolicy를 기반으로 하되 추가 필드 포함
 */
