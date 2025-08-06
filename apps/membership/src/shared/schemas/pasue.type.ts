import { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import * as schema from './entities/schema';
import { PolicyCheckResult, PolicyMetadata } from './policy.type';

export type SubscriptionPause = InferSelectModel<
  typeof schema.subscriptionPauses
>;
export type NewSubscriptionPause = InferInsertModel<
  typeof schema.subscriptionPauses
>;
export type PauseSubscriptionInput = {
  startDate: string;
  endDate: string;
  reason?: string;
};
export type ResumeSubscriptionInput = {
  reason?: string;
};
export type PauseHistoryItem = Pick<
  SubscriptionPause,
  'id' | 'startsAt' | 'endsAt' | 'actualResumedAt' | 'status'
> & {
  createdAt: string;
};
export type PauseEligibilityResponse = {
  eligible: boolean;
  currentUsage: number;
  maxPauses: number;
  remainingPauses: number;
};
export interface PausePolicyCheckResult extends PolicyCheckResult {
  metadata: PolicyMetadata & {
    pausePolicy?: {
      canPause: boolean;
      remainingPauses: number;
      maxPausesPerYear: number;
      minPauseDuration: number;
      maxPauseDuration: number;
      cooldownDays: number;
      lastPauseDate?: string;
      nextAllowedPauseDate?: string;
    };
  };
}
