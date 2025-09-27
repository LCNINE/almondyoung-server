import { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import * as schema from './entities/schema';

export type Tier = InferSelectModel<typeof schema.tiers>;
export type NewTier = InferInsertModel<typeof schema.tiers>;

export type Plan = InferSelectModel<typeof schema.plan>;
export type NewPlan = InferInsertModel<typeof schema.plan>;

export type CreateTierInput = Pick<NewTier, 'code' | 'priorityLevel'>;
export type UpdateTierInput = Partial<Pick<Tier, 'priorityLevel'>>;
export type CreatePlanInput = Pick<
  NewPlan,
  'tierId' | 'price' | 'durationDays' | 'currency' | 'trialDays'
>;
export type UpdatePlanInput = Partial<
  Pick<Plan, 'price' | 'durationDays' | 'currency' | 'trialDays' | 'isActive'>
>;
export type DeactivatePlanInput = {
  reason: string;
};

export type TierInfo = Pick<Tier, 'id' | 'code' | 'priorityLevel'>;

export type PlanInfo = Pick<
  Plan,
  'id' | 'price' | 'durationDays' | 'currency' | 'trialDays'
>;

// 더 이상 복잡한 Response 타입들을 정의하지 않습니다.
// Controller에서 필요한 데이터 가공은 직접 수행하거나,
// Drizzle에서 제공하는 기본 타입들을 그대로 사용합니다.
