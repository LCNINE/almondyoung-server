import { type InferSelectModel } from 'drizzle-orm';
import { reviewComments, reviewMedia, reviews } from '../db/schema';

export type ReviewEntity = InferSelectModel<typeof reviews>;
export type ReviewMediaEntity = InferSelectModel<typeof reviewMedia>;
export type ReviewCommentEntity = InferSelectModel<typeof reviewComments>;
export type ReviewWithMediaEntity = ReviewEntity & {
  mediaFileIds: string[];
  helpfulCount: number;
  likeCount: number;
  dislikeCount: number;
  adminComment: ReviewCommentEntity | null;
};
