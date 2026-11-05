import { type InferSelectModel } from 'drizzle-orm';
import { almondTemplateCategories } from '../../db/schema';

export type AlmondTemplateCategoryEntity = InferSelectModel<typeof almondTemplateCategories>;

export type AlmondTemplateCategoryInput = {
  name: string;
  description: string | null;
  imageFileId: string;
  kind: string;
  isVisible: boolean;
};
