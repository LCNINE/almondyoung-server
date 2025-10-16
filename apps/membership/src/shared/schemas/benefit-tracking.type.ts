import { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import * as schema from './entities/schema';

// ====== 멤버십 혜택 추적 타입 ======

export type MembershipCycleBenefit = InferSelectModel<
  typeof schema.membershipCycleBenefits
>;
export type NewMembershipCycleBenefit = InferInsertModel<
  typeof schema.membershipCycleBenefits
>;

export type MembershipDiscountEvent = InferSelectModel<
  typeof schema.membershipDiscountEvents
>;
export type NewMembershipDiscountEvent = InferInsertModel<
  typeof schema.membershipDiscountEvents
>;

// ====== 활성 구독 정보 타입 ======

export type ActiveSubscription = {
  id: string;
  userId: string;
  billingDate: Date; // 첫 결제일 (30일 주기 기준점)
  type: 'MONTHLY' | 'ANNUAL';
};
