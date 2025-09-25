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

// Plan Details 응답용 타입 (API 응답에서 사용)
export type PlanDetailsResponse = {
  id: string;
  tier: {
    id: string;
    code: string;

    priorityLevel: number;
    createdAt: string;
    updatedAt: string;
  };
  price: number;
  durationDays: number;
  currency: string;
  trialDays: number | null;
  createdAt: string;
  updatedAt: string;
};

// Tier List 응답용 타입
export type TierListResponse = Array<{
  id: string;
  code: string;

  priorityLevel: number;
  createdAt: string;
  updatedAt: string;
}>;

// Tier Benefits 응답용 타입
export type TierBenefits = {
  tier: TierInfo & {
    createdAt: string;
    updatedAt: string;
  };
  plans: Array<
    Pick<Plan, 'id' | 'price' | 'durationDays' | 'currency' | 'trialDays'> & {
      createdAt: string;
      updatedAt: string;
    }
  >;
  benefits: Array<{
    type: string;
    description: string;
    value: string;
  }>;
};
