// apps/channel-adapter/src/adapters/medusa/transformers/pim-to-medusa.transformer.ts
import { Logger } from '@nestjs/common';
import type { PimProductSnapshot, MedusaProductPayload } from '../../../types';

const logger = new Logger('PimToMedusaTransformer');
const DEFAULT_OPTION_TITLE = '기본 옵션';
const DEFAULT_OPTION_VALUE = '기본 옵션값';

export interface MedusaSyncOverrides {
  categories?: Array<{ id: string }>;
  tags?: Array<{ value: string; id?: string }>;
  type_id?: string;
  sales_channels?: string[];
}

// PIM Product Snapshot을 Medusa Upsert Payload로 변환
export function transformPimToMedusa(
  snapshot: PimProductSnapshot,
  overrides?: MedusaSyncOverrides,
): MedusaProductPayload {
  logger.log(`Transforming PIM snapshot: ${snapshot.masterId} v${snapshot.version}`);
  // Core 이벤트 snapshot 의 thumbnail/image 는 "/files/{fileId}" 상대경로로 온다.
  // 스토어프론트는 `${fileBase}/files/public/{값}` 으로 이미지 URL 을 조합하므로,
  // Medusa 에는 fileId 만 저장해야 경로 중복(`/files/public//files/...` → 깨진 이미지)이
  // 생기지 않는다. 백필 상품도 thumbnail 에 fileId 만 저장돼 있어 형태가 일치한다.
  const toFileId = (value?: string | null): string | undefined => {
    if (!value) return undefined;
    if (/^https?:\/\//i.test(value)) return value; // 이미 절대 URL 이면 보존
    return value.replace(/^\/+/, '').replace(/^files\//, '');
  };

  // 1. 기본 정보
  const title = snapshot.name || '제목 없음';
  const handle = `${snapshot.masterId}`;
  const status = mapPimStatusToMedusaStatus(snapshot.status);

  const description = undefined;

  // 2. 이미지
  // PIM의 sortOrder에 따라 정렬 - 배열 순서가 Medusa의 rank가 됨
  const images =
    snapshot.images
      ?.slice() // 원본 배열 복사
      .sort((a, b) => {
        // isPrimary가 true인 것을 먼저
        if (a.isPrimary && !b.isPrimary) return -1;
        if (!a.isPrimary && b.isPrimary) return 1;
        // 그 다음 sortOrder로 정렬
        return a.sortOrder - b.sortOrder;
      })
      .map((img) => ({
        url: toFileId(img.fileId ?? img.url) ?? img.url,
      })) || [];

  // 3. 활성 variants만 먼저 필터링 (deleted/가격없는 variant 제외)
  const SKIP_VARIANTS_WITHOUT_PRICE = process.env.SKIP_VARIANTS_WITHOUT_PRICE === 'true';
  const activeVariants = (snapshot.variants || [])
    .filter((v) => v.status !== 'deleted')
    .filter((v) => !SKIP_VARIANTS_WITHOUT_PRICE || (v.basePrice !== undefined && v.basePrice !== null));

  // 4. 옵션 스키마/제목 목록 산출 (활성 variants 기준)
  const { options, optionTitles, defaultOptionTitles, isOptionlessProduct } = buildOptionSchema(
    snapshot.optionGroups || [],
    activeVariants,
  );

  // 5. Variants 변환 (이미 필터링된 activeVariants 사용)
  const variants = transformVariants(activeVariants, optionTitles, defaultOptionTitles, isOptionlessProduct);

  // 6. 메타데이터
  const metadata = {
    pimMasterId: snapshot.masterId,
    pimVersionId: snapshot.versionId,
    pimVersion: snapshot.version,
    brand: snapshot.brand,
    seoTitle: snapshot.seoTitle,
    seoDescription: snapshot.seoDescription,
    seoKeywords: snapshot.seoKeywords,
    isWholesaleOnly: snapshot.isWholesaleOnly,
    isMembershipOnly: snapshot.isMembershipOnly,
    productType: snapshot.productType,
    pimPurchaseConstraint: snapshot.purchaseConstraint ?? null,
    syncedAt: new Date().toISOString(),
  };

  // 7. 분류
  const categories = overrides?.categories ?? snapshot.categoryIds?.map((id) => ({ id }));
  const tags = overrides?.tags ?? snapshot.tags?.map((value) => ({ value }));
  const salesChannels = overrides?.sales_channels?.map((id) => ({ id }));

  return {
    title,
    handle,
    status,
    description,
    thumbnail: toFileId(snapshot.thumbnail),
    images,
    options,
    variants,
    categories,
    tags,
    sales_channels: salesChannels,
    metadata,
    is_giftcard: snapshot.isGiftcard,
    discountable: snapshot.discountable,
  };
}

// PIM 상태를 Medusa 상태로 매핑
function mapPimStatusToMedusaStatus(pimStatus: string): 'draft' | 'published' | 'proposed' | 'rejected' {
  switch (pimStatus) {
    case 'active':
      return 'published';
    case 'draft':
      return 'draft';
    case 'inactive':
      return 'draft';
    default:
      logger.warn(`Unknown PIM status: ${pimStatus}, defaulting to 'draft'`);
      return 'draft';
  }
}

// PIM 옵션 그룹을 Medusa 옵션으로 변환
function transformOptions(
  optionGroups: PimProductSnapshot['optionGroups'],
): Array<{ title: string; values: string[] }> {
  if (!optionGroups || optionGroups.length === 0) {
    // Medusa requires at least one option
    return [{ title: DEFAULT_OPTION_TITLE, values: [DEFAULT_OPTION_VALUE] }];
  }

  return optionGroups.map((group) => ({
    title: group.name,
    values: group.values.map((v) => v.name),
  }));
}

// 옵션 스키마 구성: 옵션 제목 목록 + 각 옵션의 값 목록. Variants에 사용된 값도 포함시키며, 부족할 경우 기본 옵션값을 포함시켜 변환 시 옵션 개수 불일치 오류를 방지.
function buildOptionSchema(
  optionGroups: PimProductSnapshot['optionGroups'],
  variants: PimProductSnapshot['variants'],
): {
  options: Array<{ title: string; values: string[] }>;
  optionTitles: string[];
  defaultOptionTitles: string[];
  isOptionlessProduct: boolean;
} {
  const optionSets = new Map<string, Set<string>>();

  // 1) PIM 옵션 그룹에서 옵션 제목(name)만 초기화 (값은 variant 기준으로 수집)
  if (optionGroups && optionGroups.length > 0) {
    optionGroups.forEach((group) => {
      if (!optionSets.has(group.name)) {
        optionSets.set(group.name, new Set<string>());
      }
    });
  }

  // 2) 활성 Variants의 optionCombination에서 실제 사용 중인 값만 수집
  if (variants) {
    variants.forEach((variant) => {
      variant.optionCombination?.forEach((opt) => {
        const set = optionSets.get(opt.name) || new Set<string>();
        set.add(opt.value);
        optionSets.set(opt.name, set);
      });
    });
  }

  // 2-1) 옵션 제목은 있지만 값이 비어있는 그룹 제거 (활성 variant가 사용하지 않는 옵션)
  for (const [title, values] of optionSets) {
    if (values.size === 0) {
      optionSets.delete(title);
    }
  }

  // 3) 어떤 옵션도 없으면 기본 옵션 1개/값 1개 구성
  if (optionSets.size === 0) {
    return {
      options: [
        {
          title: DEFAULT_OPTION_TITLE,
          values: [DEFAULT_OPTION_VALUE],
        },
      ],
      optionTitles: [DEFAULT_OPTION_TITLE],
      defaultOptionTitles: [DEFAULT_OPTION_TITLE],
      isOptionlessProduct: true,
    };
  }

  const optionTitles = Array.from(optionSets.keys());

  // 4) 일부 variant가 값을 갖지 않는 옵션 타이틀에만 기본 옵션값 추가
  const defaultOptionTitles = new Set<string>();
  if (variants && variants.length > 0) {
    optionTitles.forEach((title) => {
      const hasMissing = variants.some((variant) => {
        const hasValue = variant.optionCombination?.some((opt) => opt.name === title && opt.value);
        return !hasValue;
      });
      if (hasMissing) {
        defaultOptionTitles.add(title);
        optionSets.get(title)?.add(DEFAULT_OPTION_VALUE);
      }
    });
  }

  const options = optionTitles.map((title) => ({
    title,
    values: Array.from(optionSets.get(title) || []).sort(),
  }));

  return {
    options,
    optionTitles,
    defaultOptionTitles: Array.from(defaultOptionTitles),
    isOptionlessProduct: false,
  };
}

// PIM Variants를 Medusa Variants로 변환
function transformVariants(
  pimVariants: PimProductSnapshot['variants'],
  optionTitles: string[],
  defaultOptionTitles: string[],
  isOptionlessProduct: boolean,
): MedusaProductPayload['variants'] {
  const defaultableTitles = new Set(defaultOptionTitles || []);

  if (!pimVariants || pimVariants.length === 0) {
    logger.warn('No variants found in PIM snapshot');
    return [];
  }

  // 이미 호출부에서 deleted/가격 필터링 완료된 상태
  const mapped = pimVariants.map((variant) => {
    // 옵션 조합 매핑 (부족한 옵션은 기본 옵션값으로 채워서 Medusa 옵션 개수 불일치 오류 방지)
    const rawOptions =
      variant.optionCombination?.reduce(
        (acc, opt) => {
          acc[opt.name] = opt.value;
          return acc;
        },
        {} as Record<string, string>,
      ) || {};
    const options: Record<string, string> = {};
    if (optionTitles.length > 0) {
      optionTitles.forEach((title) => {
        if (rawOptions[title]) {
          options[title] = rawOptions[title];
        } else if (defaultableTitles.has(title)) {
          options[title] = DEFAULT_OPTION_VALUE;
        }
      });
    }

    const hasOptions = optionTitles.length > 0;
    const visibleOptionValues = Object.values(options).filter(
      (value) => value && value !== 'Default' && value !== DEFAULT_OPTION_VALUE,
    );
    const isSingleVariantNoOptions = isOptionlessProduct && pimVariants.length === 1;

    // Variant 제목: 옵션 없는 단일 품목이면 "기본 품목", 그 외엔 옵션 조합/이름 우선
    const title = isSingleVariantNoOptions
      ? '기본 품목'
      : variant.variantName ||
        (visibleOptionValues.length > 0 ? visibleOptionValues.join(' / ') : `Variant ${variant.id.slice(0, 8)}`);

    // 가격 배열 구성 (기본 가격만 포함)
    const prices: Array<{
      amount: number;
      currency_code: string;
    }> = [];

    // 1. 일반 가격 (basePrice)
    if (variant.basePrice !== undefined && variant.basePrice !== null) {
      prices.push({
        amount: Math.round(variant.basePrice),
        currency_code: 'krw',
      });
    }

    const stripBarcode = process.env.STRIP_BARCODE_ON_SYNC === 'true';

    return {
      title,
      sku: variant.sku || undefined,
      barcode: stripBarcode ? undefined : variant.variantCode || undefined,
      manage_inventory: false,

      weight: variant.weight,
      length: variant.length,
      width: variant.width,
      height: variant.height,
      origin_country: variant.originCountry,
      mid_code: variant.midCode,
      hs_code: variant.hsCode,
      material: variant.material,

      options: Object.keys(options).length > 0 ? options : undefined,
      prices: prices.length > 0 ? prices : undefined,
      metadata: {
        pimVariantId: variant.id,
        variantCode: variant.variantCode,
        displayOrder: variant.displayOrder,
        // Price List 동기화를 위해 원본 가격 정보 보존
        membershipPrice: variant.membershipPrice,
        tieredPrices: variant.tieredPrices,
      },
    };
  });

  // Medusa는 한 product 안에서 옵션 조합이 모두 고유해야 한다. 옵션 매핑이 누락된
  // PIM variant 들이 buildOptionSchema 의 DEFAULT 채움으로 같은 조합으로 수렴하면
  // Medusa update가 거부된다. 첫 출현만 살리고 나머지는 경고와 함께 버린다.
  const seen = new Map<string, NonNullable<MedusaProductPayload['variants']>[number]>();
  for (const v of mapped) {
    const key = JSON.stringify(Object.entries(v.options ?? {}).sort());
    const existing = seen.get(key);
    if (existing) {
      logger.warn(
        `Dropping variant ${v.sku ?? v.title} due to duplicate option combo (kept ${existing.sku ?? existing.title}). PIM 옵션 매핑 누락 가능성.`,
      );
      continue;
    }
    seen.set(key, v);
  }
  return Array.from(seen.values());
}

// validatePimSnapshot 이 던지는 에러. error-classifier 가 name 으로 식별해
// 즉시 실패(skip) 처리하도록 한다 — data 자체가 잘못된 거라 재시도해도 같음.
export class PimSnapshotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// 최소 검증: 필수 필드 체크
export function validatePimSnapshot(snapshot: PimProductSnapshot): void {
  if (!snapshot.masterId) {
    throw new PimSnapshotValidationError('PIM snapshot missing masterId');
  }
  if (!snapshot.versionId) {
    throw new PimSnapshotValidationError('PIM snapshot missing versionId');
  }
  if (!snapshot.name) {
    throw new PimSnapshotValidationError('PIM snapshot missing name');
  }
  if (!snapshot.variants || snapshot.variants.length === 0) {
    throw new PimSnapshotValidationError('PIM snapshot must have at least one variant');
  }

  // 가격 검증: 최소 하나의 variant에 가격이 있어야 함
  const SKIP_VARIANTS_WITHOUT_PRICE = process.env.SKIP_VARIANTS_WITHOUT_PRICE === 'true';
  if (SKIP_VARIANTS_WITHOUT_PRICE) {
    const validVariants = snapshot.variants.filter(
      (v) => v.status !== 'deleted' && v.basePrice !== undefined && v.basePrice !== null,
    );
    if (validVariants.length === 0) {
      throw new PimSnapshotValidationError('PIM snapshot has no variants with valid prices');
    }
  }
}
