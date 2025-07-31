import { pgEnum } from 'drizzle-orm/pg-core';

export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'ACTIVE',
  'PAUSED',
  'CANCELLED',
  'EXPIRED',
  'PENDING_CHANGE',
]);
export const subscriptionChangeTypeEnum = pgEnum('subscription_change_type', [
  'UPGRADE',
  'DOWNGRADE',
  'RENEWAL',
  'INITIAL',
]);
export const eventPublishStatusEnum = pgEnum('event_publish_status', [
  'PENDING',
  'PUBLISHED',
  'FAILED',
]);
export const pauseStatusEnum = pgEnum('pause_status', [
  'ACTIVE',
  'ENDED',
  'CANCELLED',
]);
export const policyRuleTypeEnum = pgEnum('policy_rule_type', [
  'MAX_PAUSES_PER_YEAR',
  'MIN_PAUSE_DURATION_DAYS',
]);
