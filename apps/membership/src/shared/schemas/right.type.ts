import { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import * as schema from './entities/schema';

export type SubscriptionRight = InferSelectModel<
  typeof schema.subscriptionRights
>;
export type NewSubscriptionRight = InferInsertModel<
  typeof schema.subscriptionRights
>;

export type UserRightsResponse = Pick<
  SubscriptionRight,
  'userId' | 'tierId' | 'startsAt' | 'endsAt' | 'isActive' | 'pausedAt'
> & {
  tierCode: string;
  isPaused: boolean;
};
