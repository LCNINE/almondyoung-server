import { type InferSelectModel } from 'drizzle-orm';
import { reviewComments, reviewEligibilities, reviewMedia, reviews } from '../db/schema';

export type ReviewStatus = 'active' | 'hidden';

export type ReviewEntity = InferSelectModel<typeof reviews>;
export type ReviewMediaEntity = InferSelectModel<typeof reviewMedia>;
export type ReviewCommentEntity = InferSelectModel<typeof reviewComments>;
export type ReviewEligibilityEntity = InferSelectModel<typeof reviewEligibilities>;
export type ReviewWithMediaEntity = ReviewEntity & {
  mediaFileIds: string[];
  helpfulCount: number;
  likeCount: number;
  dislikeCount: number;
  adminComment: ReviewCommentEntity | null;
  /** 확정된 주간 베스트 리뷰인지. 목록 조회에서만 채워지고 나머지 경로는 undefined 다 */
  isBest?: boolean;
};
