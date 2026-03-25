import { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import * as schema from './entities/schema';
import { PlanInfo, Tier, TierInfo } from './plan.type';

export type SubscriptionContract = InferSelectModel<typeof schema.subscriptionContracts>;
export type NewSubscriptionContract = InferInsertModel<typeof schema.subscriptionContracts>;

export type SubscriptionEntitlement = InferSelectModel<typeof schema.subscriptionEntitlement>;
export type NewSubscriptionEntitlement = InferInsertModel<typeof schema.subscriptionEntitlement>;

export type EventBatch = InferSelectModel<typeof schema.eventBatches>;
export type NewEventBatch = InferInsertModel<typeof schema.eventBatches>;

export type BulkSubscriptionCheckResponse = Record<
  string,
  {
    hasActiveSubscription: boolean;
    tierCode?: string;
    isPaused?: boolean;
    expiresAt?: string;
  }
>;

export type CreateSubscriptionInput = {
  planId: string;
};

export type CurrentSubscriptionResponse = {
  id: string;
  currentTier: TierInfo;
  plan: PlanInfo;
  nextBillingDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  isPaused: boolean;
  pausedAt: string | null;
};
export type CancelSubscriptionInput = {
  reason?: string;
  effectiveDate?: string;
};

export type SubscriptionEntiltment = InferSelectModel<typeof schema.subscriptionEntitlement>;
export type NewSubscriptionEntiltment = InferInsertModel<typeof schema.subscriptionEntitlement>;

type TierForApiResponse = Omit<Tier, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

// UserEntitlementResponse 타입 제거됨
// 이제 Drizzle 쿼리 결과를 직접 사용합니다.
