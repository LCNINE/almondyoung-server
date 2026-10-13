import { type InferSelectModel } from 'drizzle-orm';
import { almondSavedDesigns } from '../../db/schema';

export type AlmondSavedDesignEntity = InferSelectModel<typeof almondSavedDesigns>;
export type AlmondSavedDesignSummary = Omit<AlmondSavedDesignEntity, 'design' | 'thumbnailSvg'>;
