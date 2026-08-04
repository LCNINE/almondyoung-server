import type { UpdateProductMasterVersion } from '../../../catalog.types';
import type { BulkItemPayload, FlatFields, RowError } from './bulk-session.types';

export interface ImageResolver {
  /** (imageKey, usage) → fileId. 3단계가 해석해 둔 것. */
  fileIdFor(imageKey: string, usage: 'main' | 'description'): string | undefined;
}

/** 부가이미지 상한. 2단계 검증기와 `updateVersion`(product-masters.service.ts:973) 둘 다 5 다. */
const MAX_ADDITIONAL_IMAGES = 5;

/** `::product-image{...}` 한 덩어리. product-import-image.directive.ts 에서 이식했다 — 6단계가 그 파일을 지운다. */
const DIRECTIVE_RE = /::product-image\{([^}]*)\}/g;
const IMAGE_KEY_ATTR_RE = /imageKey\s*=\s*"([^"]*)"/;

/** nullable 문자열 컬럼: 빈칸 → null. */
const NULLABLE_TEXT = [
  'productCode',
  'brand',
  'alternativeName',
  'material',
  'salesClassification',
  'purchaseClassification',
  'seller',
  'seoTitle',
  'seoDescription',
] as const satisfies ReadonlyArray<keyof UpdateProductMasterVersion>;

/** notNull boolean, 기본값 false. 'Y' 만 true 다 — 2단계 검증기가 Y/N 외를 이미 걸렀다. */
const BOOLEANS = [
  'isOverseas',
  'isVisibleToMembersOnly',
  'hideMembershipPriceForNonMembers',
  'isWholesaleOnly',
] as const satisfies ReadonlyArray<keyof UpdateProductMasterVersion>;

/** nullable bigint. 빈칸 → null. */
const NULLABLE_MONEY = ['marketPrice', 'supplyPrice'] as const satisfies ReadonlyArray<
  keyof UpdateProductMasterVersion
>;

/** notNull integer + 기본값. */
const DEFAULTED_INT = [
  ['ageRestriction', 0],
  ['minQuantity', 1],
] as const satisfies ReadonlyArray<[keyof UpdateProductMasterVersion, number]>;

export function buildVersionData(
  fields: FlatFields,
  payload: BulkItemPayload,
  images: ImageResolver,
): { data: UpdateProductMasterVersion; errors: RowError[] } {
  const data: UpdateProductMasterVersion = {};
  const errors: RowError[] = [];
  const push = (message: string): void => {
    errors.push({ sheet: '상품', rowNumber: 0, message });
  };

  /** 그 필드를 이 행이 손댔는가. 키의 **존재**가 판정 기준이고 값의 빈 여부가 아니다. */
  const touched = (key: string): boolean => `product.${key}` in fields;
  const raw = (key: string): string => (fields[`product.${key}`] ?? '').trim();

  if (touched('name')) {
    const name = raw('name');
    // 컬럼이 notNull 이고 이름 없는 상품은 목록에서 식별할 수 없다. 비우려는 의도가 있을 수
    // 없으므로 실수로 지운 것으로 본다.
    if (name === '') push('상품명은 비울 수 없습니다.');
    else data.name = name;
  }

  for (const key of NULLABLE_TEXT) {
    if (!touched(key)) continue;
    const value = raw(key);
    data[key] = value === '' ? null : value;
  }

  if (touched('description')) {
    const value = raw('description');
    data.description = value === '' ? null : replaceDirectiveImageKeys(value, images, errors);
  }

  if (touched('productType')) {
    const value = raw('productType');
    data.productType = value === '' ? 'regular_sale' : value;
  }

  if (touched('fulfillmentKind')) {
    // `fulfillmentKind` 는 스키마에서 `'physical' | 'digital'` 리터럴 유니언이다(plain string 이
    // 아니다) — 2단계 검증기(bulk-session.validator.ts:56)가 이미 그 두 값으로 걸렀으므로 여기서
    // 문자열 비교로 좁혀도 잃는 값이 없다. 캐스팅 없이 리터럴 타입을 살리는 방법이 이 삼항뿐이다.
    const value = raw('fulfillmentKind');
    data.fulfillmentKind = value === 'digital' ? 'digital' : 'physical';
  }

  for (const key of BOOLEANS) {
    if (!touched(key)) continue;
    data[key] = raw(key) === 'Y';
  }

  for (const key of NULLABLE_MONEY) {
    if (!touched(key)) continue;
    const value = raw(key);
    data[key] = value === '' ? null : Number(value);
  }

  for (const [key, fallback] of DEFAULTED_INT) {
    if (!touched(key)) continue;
    const value = raw(key);
    data[key] = value === '' ? fallback : Number(value);
  }

  if (touched('maxQuantity')) {
    const value = raw('maxQuantity');
    data.maxQuantity = value === '' ? null : Number(value);
  }

  if (touched('seoKeywords')) {
    const value = raw('seoKeywords');
    data.seoKeywords =
      value === ''
        ? []
        : value
            .split('|')
            .map((k) => k.trim())
            .filter((k) => k !== '');
  }

  for (const key of ['salesStartDate', 'salesEndDate'] as const) {
    if (!touched(key)) continue;
    const value = raw(key);
    // 2단계 검증기가 ISO 문자열로 굳혀 두었다(bulk-session.validator.ts:208-236). jsonb 왕복에서
    // Date 는 문자열이 되므로 되살리는 지점을 여기 하나로 모은다 — 문자열을 그대로 넘기면
    // drizzle 의 timestamp 매퍼가 .toISOString() 을 불러 그 행이 TypeError 로 죽는다.
    data[key] = value === '' ? null : new Date(value);
  }

  if (touched('thumbnailImageKey')) {
    const key = raw('thumbnailImageKey');
    if (key === '') data.thumbnailFileId = null;
    else {
      const fileId = images.fileIdFor(key, 'main');
      if (!fileId) push(`대표이미지키를 해석할 수 없습니다: ${key}`);
      else data.thumbnailFileId = fileId;
    }
  }

  if (touched('additionalImageKeys')) {
    const rawKeys = raw('additionalImageKeys');
    const keys =
      rawKeys === ''
        ? []
        : rawKeys
            .split('|')
            .map((k) => k.trim())
            .filter((k) => k !== '');
    if (keys.length > MAX_ADDITIONAL_IMAGES) {
      push(`부가이미지키는 ${MAX_ADDITIONAL_IMAGES}개까지 등록할 수 있습니다 (현재 ${keys.length}개).`);
    } else {
      const fileIds: string[] = [];
      for (const key of keys) {
        const fileId = images.fileIdFor(key, 'main');
        if (!fileId) push(`부가이미지키를 해석할 수 없습니다: ${key}`);
        else fileIds.push(fileId);
      }
      // 오류가 있으면 부분 목록을 싣지 않는다 — 그 행은 어차피 실패하고, 부분 목록을 실으면
      // 나중에 이 함수를 재사용하는 쪽이 "일부만 반영된 이미지"를 쓰게 된다.
      if (fileIds.length === keys.length) data.additionalImageFileIds = fileIds;
    }
  }

  // 카테고리는 2단계가 이미 경로 → id 로 해석했다(bulk-session-job.manager.ts:654-659).
  // 여기서 다시 해석하지 않는다 — 해석 규칙이 두 벌이 되면 조용히 갈린다.
  if ('category.set' in fields && payload.categoryIds) {
    data.categoryIds = payload.categoryIds;
    if (payload.primaryCategoryId) data.primaryCategoryId = payload.primaryCategoryId;
  }

  return { data, errors };
}

/**
 * 본문의 `::product-image{imageKey="..."}` 를 `fileId="..."` 로 바꾼다.
 *
 * product-import-image.directive.ts 에서 **이식**했다(import 하지 않는다 — 6단계가 그 모듈을
 * 통째로 지운다). 원본과 다른 점 하나: 해석되지 않은 키를 조용히 두지 않고 행 오류로 올린다.
 * 원본은 호출부가 이미 그 행을 실패시켰다는 전제였는데, 여기서는 이 함수가 그 판단 지점이다.
 */
function replaceDirectiveImageKeys(markdown: string, images: ImageResolver, errors: RowError[]): string {
  return markdown.replace(DIRECTIVE_RE, (whole, attrs: string) => {
    const attr = IMAGE_KEY_ATTR_RE.exec(attrs);
    if (!attr) return whole;
    const key = attr[1]?.trim();
    if (!key) return whole;
    const fileId = images.fileIdFor(key, 'description');
    if (!fileId) {
      errors.push({ sheet: '상품', rowNumber: 0, message: `상세설명의 이미지키를 해석할 수 없습니다: ${key}` });
      return whole;
    }
    return whole.replace(attr[0], `fileId="${fileId}"`);
  });
}
