import { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import * as schema from './entities/schema';

export type SubscriptionPause = InferSelectModel<typeof schema.pauseEvents>;
export type NewSubscriptionPause = InferInsertModel<typeof schema.pauseEvents>;
export type PauseSubscriptionInput = {
  startDate: string;
  endDate: string;
  reason?: string;
};
export type ResumeSubscriptionInput = {
  reason?: string;
};
export type PauseHistoryItem = Pick<SubscriptionPause, 'id' | 'eventType' | 'reason'> & {
  createdAt: string;
  startsAt?: string;
  endsAt?: string;
  adjustmentDays?: number;
};
export type PauseEligibilityResponse = {
  eligible: boolean;
  currentUsage: number;
  maxPauses: number;
  remainingPauses: number;
};
