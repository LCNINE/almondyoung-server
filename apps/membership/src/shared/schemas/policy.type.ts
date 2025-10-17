import { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import * as schema from './entities/schema';

// ====== 정책 타입 ======

export type SubscriptionPolicy = InferSelectModel<
  typeof schema.subscriptionPolicies
>;
export type NewSubscriptionPolicy = InferInsertModel<
  typeof schema.subscriptionPolicies
>;

// ====== 정책 규칙 타입 (DB Enum에서 추론) ======

// DB enum에서 타입 추론 (중복 제거, 타입 안전성 확보)
export type PolicyRuleType = SubscriptionPolicy['ruleType'];

// ====== 정책 값 타입 ======

export type PolicyValue = Record<string, any>;

// ====== 정책 조회 결과 타입 ======

export type PolicyResult = Pick<
  SubscriptionPolicy,
  | 'id'
  | 'ruleType'
  | 'ruleValue'
  | 'tierId'
  | 'isActive'
  | 'validFrom'
  | 'validUntil'
>;
