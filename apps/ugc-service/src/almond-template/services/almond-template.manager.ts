import { Injectable } from '@nestjs/common';
import { BadRequestError, NotFoundError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { eq } from 'drizzle-orm';
import { almondTemplates, type UgcServiceSchema, type UgcTx } from '../../db/schema';
import {
  ALMOND_TEMPLATE_DEFAULT_INDUSTRY,
  ALMOND_TEMPLATE_DEFAULT_PURPOSE,
  ALMOND_TEMPLATE_MAX_LAYERS_PER_SIDE,
  ALMOND_TEMPLATE_MAX_TAG_LENGTH,
  ALMOND_TEMPLATE_MAX_THUMBNAIL_LENGTH,
  ALMOND_TEMPLATE_MAX_TITLE_LENGTH,
  ALMOND_TEMPLATE_MIN_SIZE_MM,
  type AlmondTemplateStatus,
} from '../constants/almond-template.constants';
import { type AlmondTemplateEntity, type AlmondTemplateRecord } from '../types/almond-template.types';

const INT4_MAX = 2_147_483_647;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SVG_START = /^\s*(?:<\?xml[^>]*\?>\s*)?<svg[\s>]/i;
const SVG_UNSAFE = /<script|\son[a-z]+\s*=/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSizeMm(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= ALMOND_TEMPLATE_MIN_SIZE_MM && value <= INT4_MAX
  );
}

function readLayers(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value)) return null;
  const layers = value.filter(isRecord);
  return layers.length === value.length ? layers : null;
}

function readTag(design: Record<string, unknown>, field: 'industry' | 'purpose', fallback: string): string {
  if (!(field in design)) return fallback;
  const value = design[field];
  if (typeof value !== 'string' || value.length > ALMOND_TEMPLATE_MAX_TAG_LENGTH) {
    throw new BadRequestError(`시안 ${field} 값이 올바르지 않습니다.`);
  }
  return value;
}

export function parseAlmondTemplate(design: Record<string, unknown>, thumbnailSvg: string): AlmondTemplateRecord {
  const { productId, widthMm, heightMm, title } = design;
  if (typeof productId !== 'string' || !UUID.test(productId)) {
    throw new BadRequestError('상품 ID 가 올바르지 않습니다.');
  }

  const front = readLayers(design.front);
  const back = readLayers(design.back);
  if (design.version !== 1 || !front || !back) {
    throw new BadRequestError('지원하지 않는 디자인입니다.');
  }
  if (front.length === 0 && back.length === 0) {
    throw new BadRequestError('빈 시안은 저장할 수 없습니다.');
  }
  if (front.length > ALMOND_TEMPLATE_MAX_LAYERS_PER_SIDE || back.length > ALMOND_TEMPLATE_MAX_LAYERS_PER_SIDE) {
    throw new BadRequestError('레이어가 너무 많습니다.');
  }
  if (!isSizeMm(widthMm) || !isSizeMm(heightMm)) {
    throw new BadRequestError('크기가 올바르지 않습니다.');
  }

  const trimmedTitle = typeof title === 'string' ? title.trim() : '';
  if (!trimmedTitle || trimmedTitle.length > ALMOND_TEMPLATE_MAX_TITLE_LENGTH) {
    throw new BadRequestError('시안 이름이 올바르지 않습니다.');
  }

  const industry = readTag(design, 'industry', ALMOND_TEMPLATE_DEFAULT_INDUSTRY);
  const purpose = readTag(design, 'purpose', ALMOND_TEMPLATE_DEFAULT_PURPOSE);

  const colors = [
    ...new Set(
      [design.background, ...front.map((layer) => layer.fill), ...back.map((layer) => layer.fill)]
        .filter((value): value is string => typeof value === 'string' && HEX_COLOR.test(value))
        .map((value) => value.toLowerCase()),
    ),
  ];

  if (
    thumbnailSvg.length > ALMOND_TEMPLATE_MAX_THUMBNAIL_LENGTH ||
    !SVG_START.test(thumbnailSvg) ||
    SVG_UNSAFE.test(thumbnailSvg)
  ) {
    throw new BadRequestError('썸네일 SVG 가 올바르지 않습니다.');
  }

  const normalizedProductId = productId.toLowerCase();

  return {
    productId: normalizedProductId,
    widthMm,
    heightMm,
    title: trimmedTitle,
    industry,
    purpose,
    colors,
    design: { ...design, productId: normalizedProductId, title: trimmedTitle },
    thumbnailSvg,
  };
}

@Injectable()
export class AlmondTemplateManager {
  constructor(@InjectDb() private readonly db: DbService<UgcServiceSchema>) {}

  async upsert(
    design: Record<string, unknown>,
    thumbnailSvg: string,
    status: AlmondTemplateStatus,
    userId: string,
    tx?: UgcTx,
  ): Promise<AlmondTemplateEntity> {
    const record = parseAlmondTemplate(design, thumbnailSvg);

    return this.db.run(async (trx) => {
      const [row] = await trx
        .insert(almondTemplates)
        .values({ ...record, status, createdBy: userId })
        .onConflictDoUpdate({
          target: [almondTemplates.productId, almondTemplates.widthMm, almondTemplates.heightMm, almondTemplates.title],
          set: {
            industry: record.industry,
            purpose: record.purpose,
            colors: record.colors,
            design: record.design,
            thumbnailSvg: record.thumbnailSvg,
            updatedAt: new Date(),
          },
        })
        .returning();
      return row;
    }, tx);
  }

  async updateStatus(id: string, status: AlmondTemplateStatus, tx?: UgcTx): Promise<AlmondTemplateEntity> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .update(almondTemplates)
        .set({ status, updatedAt: new Date() })
        .where(eq(almondTemplates.id, id))
        .returning();
      if (!row) throw new NotFoundError(`Almond template not found: ${id}`);
      return row;
    }, tx);
  }

  async remove(id: string, tx?: UgcTx): Promise<void> {
    await this.db.run(async (trx) => {
      const deleted = await trx
        .delete(almondTemplates)
        .where(eq(almondTemplates.id, id))
        .returning({ id: almondTemplates.id });
      if (deleted.length === 0) throw new NotFoundError(`Almond template not found: ${id}`);
    }, tx);
  }
}
