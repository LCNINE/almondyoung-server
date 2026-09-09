import { type InferSelectModel } from 'drizzle-orm';
import { reviewEligibilities } from '../db/schema';

export type ReviewEligibilityEntity = InferSelectModel<typeof reviewEligibilities>;

/** 회수 배관이 자격에서 필요로 하는 최소 필드. 전체 행을 들고 다니지 않는다. */
export interface OrderEligibilityRow {
  id: string;
  userId: string;
  orderLineId: string;
  consumedByReviewId: string | null;
}

/** 자격을 회수한 결과 — 소비된 자격이면 그 리뷰 id 가 따라 나온다. */
export interface RevokedEligibilityRow {
  id: string;
  consumedByReviewId: string | null;
}
