import { type InferSelectModel } from 'drizzle-orm';
import { almondDesigns } from '../../db/schema';

export type AlmondDesignEntity = InferSelectModel<typeof almondDesigns>;
export type AlmondDesignView = Pick<AlmondDesignEntity, 'id' | 'userId' | 'design' | 'templateId' | 'createdAt'> & {
  hasBack: boolean;
};
export interface AlmondDesignInfo {
  id: string;
  productId: string;
  widthMm: number;
  heightMm: number;
  hasBack: boolean;
}
export type AlmondDesignPrintSource = Pick<AlmondDesignEntity, 'id' | 'frontSvg' | 'backSvg'>;

export interface AlmondDesignRecord {
  productId: string;
  widthMm: number;
  heightMm: number;
  templateId: string | null;
  design: Record<string, unknown>;
  frontSvg: string;
  backSvg: string | null;
}

export type AlmondPrintFormat = 'eps' | 'pdf' | 'jpg';

export interface AlmondPrintFile {
  fileName: string;
  contentType: string;
  body: Buffer;
}

export interface AlmondPrintLink {
  url: string;
  expiresAt: string;
  fileName: string;
}
