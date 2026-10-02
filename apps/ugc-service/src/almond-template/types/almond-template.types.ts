import { type InferSelectModel } from 'drizzle-orm';
import { almondTemplates } from '../../db/schema';

export type AlmondTemplateEntity = InferSelectModel<typeof almondTemplates>;
export type AlmondTemplateSummary = Omit<AlmondTemplateEntity, 'design' | 'thumbnailSvg'>;
export type AdminAlmondTemplateSummary = AlmondTemplateSummary & { kind: string | null };

export interface AlmondTemplateRecord {
  productId: string;
  widthMm: number;
  heightMm: number;
  title: string;
  industry: string;
  purpose: string;
  colors: string[];
  design: Record<string, unknown>;
  thumbnailSvg: string;
}
