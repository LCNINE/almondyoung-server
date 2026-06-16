// apps/medusa/src/scripts/lib/transformer.ts
//
// SOURCE OF TRUTH: apps/channel-adapter/src/adapters/medusa/transformers/pim-to-medusa.transformer.ts
// 변경 시 양쪽 동기화. Medusa 컨테이너 내부 backfill 전용 — channel-adapter 의 NestJS Logger 의존을
// 피하기 위해 콘솔 기반 로거로 단순화하고, 타입(PimProductSnapshot, MedusaProductPayload)은 인라인.

const logger = {
  log: (msg: string) => console.log(`[Transformer] ${msg}`),
  warn: (msg: string) => console.warn(`[Transformer] ${msg}`),
};
const DEFAULT_OPTION_TITLE = '기본 옵션';
const DEFAULT_OPTION_VALUE = '기본 옵션값';

// ─── 인라인 타입 ───────────────────────────────────────────────────────────
export interface PimProductSnapshot {
  masterId: string;
  versionId: string;
  version: number;
  name: string;
  handle?: string;
  description?: string;
  descriptionHtml?: string;
  thumbnail?: string;
  images?: Array<{ fileId: string; url: string; isPrimary: boolean; sortOrder: number }>;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string[];
  categoryIds?: string[];
  categories?: Array<{
    id: string;
    name: string;
    slug: string;
    path: string;
    parentId: string | null;
    isActive: boolean;
    visibility: boolean;
    showOnMainCategory: boolean;
    thumbnail?: string;
  }>;
  brand?: string;
  tags?: string[];
  productType?: string;
  optionGroups?: Array<{
    id: string;
    name: string;
    values: Array<{ id: string; name: string; colorCode?: string; imageUrl?: string }>;
  }>;
  variants: Array<{
    id: string;
    variantName?: string;
    sku?: string;
    variantCode?: string;
    isDefault: boolean;
    status: string;
    displayOrder?: number;
    optionCombination?: Array<{ name: string; value: string }>;
    basePrice?: number;
    membershipPrice?: number;
    tieredPrices?: Array<{ minQuantity: number; price: number }>;
    weight?: number;
    length?: number;
    width?: number;
    height?: number;
    originCountry?: string;
    midCode?: string;
    hsCode?: string;
    material?: string;
  }>;
  status: 'draft' | 'active' | 'inactive';
  isWholesaleOnly?: boolean;
  hideMembershipPriceForNonMembers?: boolean;
  isVisibleToMembersOnly?: boolean;
  /** @deprecated use hideMembershipPriceForNonMembers */
  isMembershipOnly?: boolean;
  isGiftcard?: boolean;
  discountable?: boolean;
}

export interface MedusaProductPayload {
  title: string;
  handle: string;
  status: 'draft' | 'published' | 'proposed' | 'rejected';
  description?: string;
  thumbnail?: string;
  images?: Array<{ url: string }>;
  options?: Array<{ title: string; values: string[] }>;
  variants?: Array<{
    id?: string;
    title?: string;
    sku?: string;
    barcode?: string;
    manage_inventory?: boolean;
    weight?: number;
    length?: number;
    width?: number;
    height?: number;
    origin_country?: string;
    mid_code?: string;
    hs_code?: string;
    material?: string;
    options?: Record<string, string>;
    prices?: Array<{ amount: number; currency_code: string }>;
    metadata?: Record<string, unknown>;
  }>;
  categories?: Array<{ id: string }>;
  tags?: Array<{ value: string; id?: string }>;
  type_id?: string;
  sales_channels?: Array<{ id: string }>;
  metadata?: Record<string, unknown>;
  is_giftcard?: boolean;
  discountable?: boolean;
}

export interface MedusaSyncOverrides {
  categories?: Array<{ id: string }>;
  tags?: Array<{ value: string; id?: string }>;
  type_id?: string;
  sales_channels?: string[];
}

// ─── 변환 ──────────────────────────────────────────────────────────────────

export function transformPimToMedusa(
  snapshot: PimProductSnapshot,
  overrides?: MedusaSyncOverrides,
): MedusaProductPayload {
  logger.log(`Transforming PIM snapshot: ${snapshot.masterId} v${snapshot.version}`);
  const toFileUrl = (fileId?: string | null): string | undefined => {
    if (!fileId) return undefined;
    if (/^https?:\/\//i.test(fileId)) return fileId;
    const base = process.env.FILE_SERVICE_URL;
    if (!base) return fileId;
    return `${base.replace(/\/$/, '')}/files/${fileId}`;
  };

  const title = snapshot.name || '제목 없음';
  const handle = `${snapshot.masterId}`;
  const status = mapPimStatusToMedusaStatus(snapshot.status);
  const description = undefined;

  const images =
    snapshot.images
      ?.slice()
      .sort((a, b) => {
        if (a.isPrimary && !b.isPrimary) return -1;
        if (!a.isPrimary && b.isPrimary) return 1;
        return a.sortOrder - b.sortOrder;
      })
      .map((img) => ({ url: img.url })) || [];

  const SKIP_VARIANTS_WITHOUT_PRICE = process.env.SKIP_VARIANTS_WITHOUT_PRICE === 'true';
  const activeVariants = (snapshot.variants || [])
    .filter((v) => v.status !== 'deleted')
    .filter((v) => !SKIP_VARIANTS_WITHOUT_PRICE || (v.basePrice !== undefined && v.basePrice !== null));

  const { options, optionTitles, defaultOptionTitles, isOptionlessProduct } = buildOptionSchema(
    snapshot.optionGroups || [],
    activeVariants,
  );

  const variants = transformVariants(activeVariants, optionTitles, defaultOptionTitles, isOptionlessProduct);

  const hideMembershipPriceForNonMembers =
    snapshot.hideMembershipPriceForNonMembers ?? snapshot.isMembershipOnly ?? false;

  const metadata = {
    pimMasterId: snapshot.masterId,
    pimVersionId: snapshot.versionId,
    pimVersion: snapshot.version,
    brand: snapshot.brand,
    seoTitle: snapshot.seoTitle,
    seoDescription: snapshot.seoDescription,
    seoKeywords: snapshot.seoKeywords,
    isWholesaleOnly: snapshot.isWholesaleOnly,
    hideMembershipPriceForNonMembers,
    isMembershipOnly: hideMembershipPriceForNonMembers,
    isVisibleToMembersOnly: snapshot.isVisibleToMembersOnly ?? false,
    productType: snapshot.productType,
    syncedAt: new Date().toISOString(),
  };

  const categories = overrides?.categories ?? snapshot.categoryIds?.map((id) => ({ id }));
  const tags = overrides?.tags ?? snapshot.tags?.map((value) => ({ value }));
  const salesChannels = overrides?.sales_channels?.map((id) => ({ id }));

  return {
    title,
    handle,
    status,
    description,
    thumbnail: toFileUrl(snapshot.thumbnail),
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

  if (optionGroups && optionGroups.length > 0) {
    optionGroups.forEach((group) => {
      if (!optionSets.has(group.name)) optionSets.set(group.name, new Set<string>());
    });
  }

  if (variants) {
    variants.forEach((variant) => {
      variant.optionCombination?.forEach((opt) => {
        const set = optionSets.get(opt.name) || new Set<string>();
        set.add(opt.value);
        optionSets.set(opt.name, set);
      });
    });
  }

  for (const [title, values] of optionSets) {
    if (values.size === 0) optionSets.delete(title);
  }

  if (optionSets.size === 0) {
    return {
      options: [{ title: DEFAULT_OPTION_TITLE, values: [DEFAULT_OPTION_VALUE] }],
      optionTitles: [DEFAULT_OPTION_TITLE],
      defaultOptionTitles: [DEFAULT_OPTION_TITLE],
      isOptionlessProduct: true,
    };
  }

  const optionTitles = Array.from(optionSets.keys());
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

  const mapped = pimVariants.map((variant) => {
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

    const visibleOptionValues = Object.values(options).filter(
      (value) => value && value !== 'Default' && value !== DEFAULT_OPTION_VALUE,
    );
    const isSingleVariantNoOptions = isOptionlessProduct && pimVariants.length === 1;

    const title = isSingleVariantNoOptions
      ? '기본 품목'
      : variant.variantName ||
        (visibleOptionValues.length > 0 ? visibleOptionValues.join(' / ') : `Variant ${variant.id.slice(0, 8)}`);

    const prices: Array<{ amount: number; currency_code: string }> = [];
    if (variant.basePrice !== undefined && variant.basePrice !== null) {
      prices.push({ amount: Math.round(variant.basePrice), currency_code: 'krw' });
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
        membershipPrice: variant.membershipPrice,
        tieredPrices: variant.tieredPrices,
      },
    };
  });

  const seen = new Map<string, NonNullable<MedusaProductPayload['variants']>[number]>();
  for (const v of mapped) {
    const key = JSON.stringify(Object.entries(v.options ?? {}).sort());
    const existing = seen.get(key);
    if (existing) {
      logger.warn(
        `Dropping variant ${v.sku ?? v.title} due to duplicate option combo (kept ${existing.sku ?? existing.title}).`,
      );
      continue;
    }
    seen.set(key, v);
  }
  return Array.from(seen.values());
}

export class PimSnapshotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function validatePimSnapshot(snapshot: PimProductSnapshot): void {
  if (!snapshot.masterId) throw new PimSnapshotValidationError('PIM snapshot missing masterId');
  if (!snapshot.versionId) throw new PimSnapshotValidationError('PIM snapshot missing versionId');
  if (!snapshot.name) throw new PimSnapshotValidationError('PIM snapshot missing name');
  if (!snapshot.variants || snapshot.variants.length === 0) {
    throw new PimSnapshotValidationError('PIM snapshot must have at least one variant');
  }

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
