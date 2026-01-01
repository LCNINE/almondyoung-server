import { type InferSelectModel } from 'drizzle-orm';
import { reviews } from '../db/schema';

export type ReviewEntity = InferSelectModel<typeof reviews>;
