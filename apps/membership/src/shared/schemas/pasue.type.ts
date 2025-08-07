import { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import * as schema from './entities/schema';

export type SubscriptionPause = InferSelectModel<typeof schema.pausePeriods>;
export type NewSubscriptionPause = InferInsertModel<typeof schema.pausePeriods>;
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
  'id' | 'startsAt' | 'endsAt' | 'reason'
> & {
  createdAt: string;
};
export type PauseEligibilityResponse = {
  eligible: boolean;
  currentUsage: number;
  maxPauses: number;
  remainingPauses: number;
};
