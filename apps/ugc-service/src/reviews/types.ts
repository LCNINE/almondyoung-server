import { type InferSelectModel } from 'drizzle-orm';
import { reviewMedia, reviews } from '../db/schema';

export type ReviewEntity = InferSelectModel<typeof reviews>;
export type ReviewMediaEntity = InferSelectModel<typeof reviewMedia>;
export type ReviewWithMediaEntity = ReviewEntity & {
  mediaFileIds: string[];
  helpfulCount: number;
};
