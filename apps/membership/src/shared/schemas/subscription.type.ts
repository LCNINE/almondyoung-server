import { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import * as schema from './entities/schema';
import { PlanInfo, TierInfo } from './plan.type';

export type Subscription = InferSelectModel<typeof schema.subscriptions>;
export type NewSubscription = InferInsertModel<typeof schema.subscriptions>;

export type SubscriptionEvent = InferSelectModel<
  typeof schema.subscriptionEvents
>;
export type NewSubscriptionEvent = InferInsertModel<
  typeof schema.subscriptionEvents
>;

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
  status: Subscription['status'];
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
