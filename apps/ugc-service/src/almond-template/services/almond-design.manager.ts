import { Injectable } from '@nestjs/common';
import { BadRequestError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { almondDesigns, type UgcServiceSchema, type UgcTx } from '../../db/schema';
import { ALMOND_TEMPLATE_MAX_LAYERS_PER_SIDE } from '../constants/almond-template.constants';
import { assertSafeDesignSvg } from '../print/almond-print-svg';
import { type AlmondDesignRecord, type AlmondDesignView } from '../types/almond-design.types';
import { isRecord, isSizeMm, readLayers, UUID } from './almond-template.manager';

const DATA_URI = /^\s*data:[a-z]+\/[a-z0-9.+-]+[;,]/i;

function containsDataUri(value: unknown): boolean {
  if (typeof value === 'string') return DATA_URI.test(value);
  if (Array.isArray(value)) return value.some(containsDataUri);
  if (isRecord(value)) return Object.values(value).some(containsDataUri);
  return false;
}

export interface AlmondDesignInput {
  design: Record<string, unknown>;
  frontSvg: string;
  backSvg?: string;
  templateId?: string;
}

export function parseAlmondDesign(input: AlmondDesignInput): AlmondDesignRecord {
  const { design, frontSvg, backSvg, templateId } = input;
  const { productId, widthMm, heightMm } = design;

  const front = readLayers(design.front);
  const back = readLayers(design.back);
  if (design.version !== 1 || !front || !back) {
    throw new BadRequestError('지원하지 않는 디자인입니다.');
  }
  if (front.length > ALMOND_TEMPLATE_MAX_LAYERS_PER_SIDE || back.length > ALMOND_TEMPLATE_MAX_LAYERS_PER_SIDE) {
    throw new BadRequestError('레이어가 너무 많습니다.');
  }
  if (!isSizeMm(widthMm) || !isSizeMm(heightMm)) {
    throw new BadRequestError('크기가 올바르지 않습니다.');
  }
  if (typeof productId !== 'string' || !UUID.test(productId)) {
    throw new BadRequestError('상품 ID 가 올바르지 않습니다.');
  }
  if (templateId !== undefined && !UUID.test(templateId)) {
    throw new BadRequestError('템플릿 ID 가 올바르지 않습니다.');
  }
  if (containsDataUri(design)) {
    throw new BadRequestError('시안 JSON 에 이미지를 직접 넣을 수 없습니다. 업로드한 파일(file:<id>)로 참조하세요.');
  }

  assertSafeDesignSvg(frontSvg, 'front');
  if (back.length > 0 && backSvg === undefined) {
    throw new BadRequestError('뒷면 SVG 가 필요합니다.');
  }
  if (backSvg !== undefined) assertSafeDesignSvg(backSvg, 'back');

  const normalizedProductId = productId.toLowerCase();
  return {
    productId: normalizedProductId,
    widthMm,
    heightMm,
    templateId: templateId?.toLowerCase() ?? null,
    design: { ...design, productId: normalizedProductId },
    frontSvg,
    backSvg: back.length > 0 ? (backSvg ?? null) : null,
  };
}

@Injectable()
export class AlmondDesignManager {
  constructor(@InjectDb() private readonly db: DbService<UgcServiceSchema>) {}

  async create(
    input: AlmondDesignInput,
    userId: string,
    tx?: UgcTx,
  ): Promise<Pick<AlmondDesignView, 'id' | 'createdAt'>> {
    const record = parseAlmondDesign(input);
    return this.db.run(async (trx) => {
      const [row] = await trx
        .insert(almondDesigns)
        .values({ ...record, userId })
        .returning({ id: almondDesigns.id, createdAt: almondDesigns.createdAt });
      return row;
    }, tx);
  }
}
