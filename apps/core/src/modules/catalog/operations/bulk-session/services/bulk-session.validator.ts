import type { AssembledRow } from './bulk-upload.assembler';
import type { PrefillRow, RowError } from './bulk-session.types';
import {
  CONSTRAINT_COLUMNS,
  ColumnDef,
  OPTION_COLUMNS,
  PRICING_SENTINEL,
  PRODUCT_COLUMNS,
  VARIANT_COLUMNS,
} from './form-export.sheets';

/**
 * varchar 상한. `catalog.schema.ts` 실측값이다(리뷰 시점 줄 번호):
 * `name` 255(:138) · `brand` 100(:140) · `seoTitle` 255(:143) · `productCode` 100(:164) ·
 * `alternativeName` 255(:165) · `salesClassification` 100(:169) · `purchaseClassification`
 * 100(:170) · `seller` 100(:200) · `rowKey` 100(`product_bulk_items.row_key`:1044,
 * `product_form_export_items.row_key`:1387 — 워크북 전 시트가 같은 상품키 문자열을 공유하므로
 * 상품 시트에서 한 번만 검사하면 충분하다).
 *
 * 넘으면 프리뷰는 통과하고 4단계 write 에서 Postgres 22001(string_data_right_truncation)로
 * 그 행만 죽는다 — v3 는 일부 필드만 검사해 이 구멍이 남아 있었다(스펙 §2.8·§3.12). 이
 * 태스크가 '상품' 시트뿐 아니라 '조합'·'옵션' 시트 칸까지 전부 닫는다(아래 VARIANT/OPTION
 * 상한 참고) — Task 7 은 옵션·조합의 **구조**(키 존재·중복)만 보고 표시명 같은 값은 보지
 * 않으므로, 여기서 안 막으면 어떤 게이트도 이 값을 못 본다.
 */
const PRODUCT_MAX_LENGTH: Record<string, number> = {
  rowKey: 100,
  name: 255,
  alternativeName: 255,
  seoTitle: 255,
  brand: 100,
  productCode: 100,
  seller: 100,
  salesClassification: 100,
  purchaseClassification: 100,
};

/** `product_variants.variant_code varchar(100)` (catalog.schema.ts:484). */
const VARIANT_MAX_LENGTH: Record<string, number> = {
  variantCode: 100,
};

/**
 * `product_option_group_displays.display_name varchar(100)` (catalog.schema.ts:401),
 * `product_option_value_displays.display_name varchar(100)` (:429),
 * `product_option_value_displays.color_code varchar(7)` (:430) — 7자라 실수 한 번으로 넘는다.
 */
const OPTION_MAX_LENGTH: Record<string, number> = {
  optionName: 100,
  optionValueName: 100,
  colorCode: 7,
};

const ENUMS: Record<string, string[]> = {
  productType: ['regular_sale', 'limited_edition'],
  fulfillmentKind: ['physical', 'digital'],
  // 프리필은 항상 대문자 'Y'/'N' 만 찍는다(form-export.snapshot.reader.ts 의 yn() 헬퍼).
  // 'y'·'예'·'TRUE' 처럼 다르게 적어도 4단계가 조용히 false 로 읽어 무시하면(=값이 안 틀렸다고
  // 착각하고 넘어가면) 아무도 오류를 못 본다 — 형식 오류로 명시적으로 걸러야 한다.
  isOverseas: ['Y', 'N'],
  isVisibleToMembersOnly: ['Y', 'N'],
  hideMembershipPriceForNonMembers: ['Y', 'N'],
  isWholesaleOnly: ['Y', 'N'],
};

const SALES_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const SALES_DATE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
/**
 * 날짜만 적힌 칸을 KST 경계로 해석한다. UTC 로 읽으면 "8월 31일까지 판매"가 그날
 * 09:00(KST) 에 끝나 조용히 품절된다 — MD 는 KST 로 생각한다. KST 는 DST 가 없어
 * 오프셋이 항상 +09:00 이므로 문자열에 박아 넣으면 서버 TZ 와 무관해진다.
 * (선례: product-import.validator.ts:24-28)
 */
const KST_OFFSET = '+09:00';

const MAX_ADDITIONAL_IMAGE_KEYS = 5;
/**
 * Postgres `integer` 컬럼의 상한. `lifetimeQuantityLimit`(catalog.schema.ts:347)·
 * `minQuantity`(:182)·`maxQuantity`(:183) 셋 다 진짜 `integer` 타입이라 이 값을 공유한다 —
 * 넘기면 프리뷰는 통과하고 commit 에서 Postgres 22003(numeric_value_out_of_range)로 그
 * 행만 죽는다. 이름을 필드 하나에 묶지 않은 이유는 세 필드가 "왜 같은 상한을 쓰는가"가
 * 코드에서 바로 보이게 하기 위해서다 — 컬럼 타입이 같아서지, 우연히 같은 숫자가 아니다.
 */
const POSTGRES_INTEGER_MAX = 2_147_483_647;

function toLabelMap(columns: ColumnDef[]): Record<string, string> {
  return Object.fromEntries(columns.map((c) => [c.key, c.label]));
}

/** 필드 key → 워크북 한국어 헤더. 오류 메시지는 전부 이걸 통해서만 필드를 지칭한다. */
const FIELD_LABELS: Record<string, string> = {
  ...toLabelMap(PRODUCT_COLUMNS),
  ...toLabelMap(OPTION_COLUMNS),
  ...toLabelMap(VARIANT_COLUMNS),
  ...toLabelMap(CONSTRAINT_COLUMNS),
};

function label(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/**
 * 오류 메시지 하나를 싣는 콜백. 시트·행번호는 호출부(`validateFields`)가 이미 closure 로
 * 고정해 넘긴다 — 조합·옵션·구매제약처럼 접합 단계에서 물리 행번호를 잃는 시트는 `rowNumber: 0`
 * 을 고정하고 메시지에 식별 문자열을 싣는 closure 를 쓴다(계획의 Task 7 카테고리 항목 규약).
 */
type Push = (message: string) => void;

/** 채워진 칸에만 거는 varchar 상한 검사. 상품·조합·옵션 시트 공용. */
function checkMaxLength(fields: PrefillRow, limits: Record<string, number>, push: Push): void {
  for (const [field, max] of Object.entries(limits)) {
    const value = (fields[field] ?? '').trim();
    if (value === '') continue;
    if (value.length > max) push(`${label(field)}은(는) ${max}자 이하여야 합니다 (현재 ${value.length}자).`);
  }
}

/**
 * 가격 칸(basePrice/membershipPrice) 하나를 센티넬 규약대로 해석한다.
 *
 * - `pricingEditable === false`: 센티넬이거나 빈칸이면 유효(= 가격 변경 없음). 그 외 값이면
 *   "임포트로 못 고친다" 오류.
 * - `pricingEditable === true`: 빈칸이면 값 없음(undefined). 아니면 숫자로 파싱한다 —
 *   센티넬 문자열은 숫자가 아니므로 여기서 파싱 실패로 걸린다. 원화는 소수 단위가 없으므로
 *   정수가 아니면 오류(안 막으면 Zod 파싱 실패로 나중에 죽는다).
 */
function resolvePriceCell(
  raw: string,
  field: string,
  ctx: { pricingEditable: boolean },
  push: Push,
): number | undefined {
  if (!ctx.pricingEditable) {
    if (raw === '' || raw === PRICING_SENTINEL) return undefined;
    push(`복합 가격규칙 상품의 ${label(field)}은(는) 임포트로 수정할 수 없습니다: ${raw}`);
    return undefined;
  }

  if (raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    push(`${label(field)}는 0 이상의 숫자여야 합니다: ${raw}`);
    return undefined;
  }
  if (!Number.isInteger(n)) {
    push(`${label(field)}는 정수여야 합니다 (원화는 소수 단위가 없습니다): ${raw}`);
    return undefined;
  }
  return n;
}

/**
 * 가격 칸 한 쌍(basePrice·membershipPrice)을 센티넬 규약대로 파싱한다. 상품·조합 공용 —
 * 규칙 3(가격 센티넬)은 "상품·조합" 양쪽에 동일하게 적용된다. `basePrice` 0원 금지·필수
 * 여부·멤버십가 비교 같은 **게시 규칙**은 여기 포함하지 않는다 — 채워진 칸이 있는지 없는지만
 * 파싱하고, 그 값으로 무엇을 판단할지는 호출부(상품 레벨/조합 레벨)가 각자 정한다.
 */
function parsePriceCells(
  fields: PrefillRow,
  ctx: { pricingEditable: boolean },
  push: Push,
): { base: number | undefined; baseRaw: string; member: number | undefined } {
  const baseRaw = (fields.basePrice ?? '').trim();
  const memberRaw = (fields.membershipPrice ?? '').trim();

  const base = resolvePriceCell(baseRaw, 'basePrice', ctx, push);
  const member = resolvePriceCell(memberRaw, 'membershipPrice', ctx, push);

  return { base, baseRaw, member };
}

/**
 * 채워진 칸만 정수 범위로 검사한다(선례: product-import.validator.ts:263-279 `intInRange`).
 * 이 검증기는 `RowError[]` 만 반환하는 순수 함수라 선례처럼 "기본값을 채운 결과 객체"를
 * 만들지 않는다 — 빈칸은 그냥 건너뛴다(호출부가 필요하면 스키마 기본값을 직접 적용한다).
 */
function parseIntInRange(raw: string, field: string, min: number, max: number, push: Push): number | undefined {
  const value = raw.trim();
  if (value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    push(`${label(field)}는 ${min}~${max === Number.MAX_SAFE_INTEGER ? '∞' : max} 범위의 정수여야 합니다: ${value}`);
    return undefined;
  }
  return n;
}

/**
 * 채워진 칸만 "0 이상의 숫자"로 검사한다. `marketPrice`/`supplyPrice` 는 pricing rules 로
 * 가지 않으므로 `basePrice`/`membershipPrice` 와 달리 정수 요구가 없다(선례: 두 필드 모두
 * `optionalMoney` 를 쓰고 `optionalIntegerMoney` 를 쓰지 않는다 — product-import.validator.ts:62-63).
 */
function checkNonNegativeMoney(raw: string, field: string, push: Push): void {
  const value = raw.trim();
  if (value === '') return;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) push(`${label(field)}는 0 이상의 숫자여야 합니다: ${value}`);
}

/**
 * 'YYYY-MM-DD' 또는 'YYYY-MM-DD HH:mm' 을 KST 로 해석해 ISO8601(UTC) 문자열로 돌려준다.
 * 규약·근거는 product-import.validator.ts:297-346(`salesDate`/`isValidCalendarDate`) 과 동일하다
 * — 느슨한 `new Date(문자열)` 은 '08/01/2026' 같은 입력을 조용히 해석해 MD 의 의도와 다른
 * 날짜가 게시된다. `Date.UTC` 왕복으로 2026-02-30 같은 달력 오버플로도 잡는다.
 * 옛 임포트는 6단계에서 제거될 예정이라 공통 추상화를 뽑지 않는다 — 오류 메시지만 이
 * 워크북의 한국어 헤더 이름으로 새로 쓴다.
 */
function validateSalesDate(raw: string, field: string, endOfDay: boolean, push: Push): string | undefined {
  const value = raw.trim();
  if (value === '') return undefined;

  let iso: string;
  if (SALES_DATE_ONLY.test(value)) {
    iso = `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}${KST_OFFSET}`;
  } else if (SALES_DATE_TIME.test(value)) {
    iso = `${value.replace(' ', 'T')}:00.000${KST_OFFSET}`;
  } else {
    push(`${label(field)}은(는) 'YYYY-MM-DD' 또는 'YYYY-MM-DD HH:mm' 형식이어야 합니다: ${value}`);
    return undefined;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (!isValidCalendarDate(year, month, day)) {
    push(`${label(field)}은(는) 존재하지 않는 날짜입니다: ${value}`);
    return undefined;
  }

  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    push(`${label(field)}은(는) 존재하지 않는 날짜입니다: ${value}`);
    return undefined;
  }
  return parsed.toISOString();
}

/**
 * Date.UTC 왕복으로 실재하지 않는 날짜(2026-02-30, 4월 31일 등)를 잡아낸다 — day 오버플로는
 * `new Date(ISO 문자열)` 이 조용히 다음 달로 넘겨버려 NaN 이 되지 않으므로 별도 검증이
 * 필요하다. UTC 만 쓰므로 KST 오프셋·서버 TZ 와 무관하다. (선례: product-import.validator.ts:348-356)
 */
function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * 행 하나의 필드 수준 검증. 순수 함수 — DB 를 타지 않고 `RowError[]` 를 반환한다(예외를
 * 던지면 이 행만이 아니라 전체 배치가 죽는다).
 *
 * - 길이·열거·숫자 형식 검증은 `kind` 와 무관하게 값이 채워진 칸에만 건다.
 * - 필수 검증(상품명·판매가)은 `kind === 'create'` 에만 건다 — 수정 행의 빈칸은
 *   "변경 없음"이지 누락이 아니다(스펙 §3.5).
 * - 조합·옵션·구매제약 오류는 접합 단계(Task 5)에서 물리 행번호를 잃으므로 `rowNumber: 0`
 *   에 식별 문자열을 실어 보낸다.
 */
export function validateFields(row: AssembledRow, ctx: { pricingEditable: boolean }): RowError[] {
  const errors: RowError[] = [];
  const pushProduct: Push = (message) => errors.push({ sheet: '상품', rowNumber: row.rowNumber, message });
  const pushConstraint: Push = (message) => errors.push({ sheet: '구매제약', rowNumber: 0, message });
  const product = row.bundle.product;
  const isCreate = row.kind === 'create';

  if (isCreate) {
    const name = (product.name ?? '').trim();
    if (name === '') pushProduct(`${label('name')}은 필수입니다.`);
  }

  checkMaxLength(product, PRODUCT_MAX_LENGTH, pushProduct);

  for (const [field, allowed] of Object.entries(ENUMS)) {
    const value = (product[field] ?? '').trim();
    if (value === '') continue;
    if (!allowed.includes(value)) {
      pushProduct(`${label(field)}은(는) [${allowed.join(', ')}] 중 하나여야 합니다: ${value}`);
    }
  }

  const additionalImageKeys = (product.additionalImageKeys ?? '').trim();
  if (additionalImageKeys !== '') {
    const keys = additionalImageKeys
      .split('|')
      .map((k) => k.trim())
      .filter((k) => k !== '');
    if (keys.length > MAX_ADDITIONAL_IMAGE_KEYS) {
      pushProduct(
        `${label('additionalImageKeys')}는 ${MAX_ADDITIONAL_IMAGE_KEYS}개까지 등록할 수 있습니다 (현재 ${keys.length}개).`,
      );
    }
  }

  // ageRestriction 0~100 기본 0, minQuantity ≥1 기본 1 — 선례(product-import.validator.ts:85-94)
  // 의 범위·기본값 규약을 가져온다. 단 minQuantity/maxQuantity 의 상한은 선례의
  // Number.MAX_SAFE_INTEGER 를 그대로 옮기지 않는다 — 두 컬럼은 진짜 Postgres integer 라
  // 선례가 거기서만 갖고 있던 구멍(자릿수 오타가 22003 으로 commit 에서 죽는다)까지 물려받게
  // 된다. 대신 POSTGRES_INTEGER_MAX 를 쓴다(아래 lifetimeQuantityLimit 과 같은 이유·같은 값).
  parseIntInRange(product.ageRestriction ?? '', 'ageRestriction', 0, 100, pushProduct);
  const minQuantity = parseIntInRange(product.minQuantity ?? '', 'minQuantity', 1, POSTGRES_INTEGER_MAX, pushProduct);
  const maxQuantityRaw = (product.maxQuantity ?? '').trim();
  if (maxQuantityRaw !== '') {
    const maxQuantity = parseIntInRange(maxQuantityRaw, 'maxQuantity', 1, POSTGRES_INTEGER_MAX, pushProduct);
    // minQuantity 가 비었으면(칸을 안 건드렸으면) 스키마 기본값 1 을 상속해 비교한다.
    const effectiveMin = minQuantity ?? 1;
    if (maxQuantity !== undefined && maxQuantity < effectiveMin) {
      pushProduct(
        `${label('maxQuantity')}는 ${label('minQuantity')} 이상이어야 합니다: ${maxQuantity} < ${effectiveMin}`,
      );
    }
  }

  checkNonNegativeMoney(product.marketPrice ?? '', 'marketPrice', pushProduct);
  checkNonNegativeMoney(product.supplyPrice ?? '', 'supplyPrice', pushProduct);

  const { base, baseRaw, member } = parsePriceCells(product, ctx, pushProduct);
  if (ctx.pricingEditable) {
    if (base !== undefined) {
      // 판매가 0 은 게시할 수 없는 상품이다 — 안 막으면 계산기가 0 을 내고 스토어프론트까지
      // 0원 상품이 나간다(선례: product-import.validator.ts:66-74).
      if (base <= 0) {
        pushProduct(`${label('basePrice')}는 0보다 큰 숫자여야 합니다 (판매가 없이 게시할 수 없습니다): ${baseRaw}`);
      }
    } else if (isCreate && baseRaw === '') {
      pushProduct(`${label('basePrice')}는 필수입니다 (판매가 없이 게시할 수 없습니다).`);
    }

    if (member !== undefined && base !== undefined && member > base) {
      pushProduct(`${label('membershipPrice')}는 ${label('basePrice')} 이하여야 합니다: ${member} > ${base}`);
    }
  }

  for (const opt of row.bundle.options) {
    // 옵션·옵션값은 접합 단계에서 물리 행번호를 잃는다 — 표시명 조합으로 어느 칸인지 알린다.
    const optionName = (opt.optionName ?? '').trim() || (opt.optionKey ?? '').trim() || '(옵션)';
    const valueName = (opt.optionValueName ?? '').trim() || (opt.optionValueKey ?? '').trim();
    const identifier = valueName ? `${optionName}/${valueName}` : optionName;
    const pushOption: Push = (message) =>
      errors.push({ sheet: '옵션', rowNumber: 0, message: `[옵션 ${identifier}] ${message}` });

    checkMaxLength(opt, OPTION_MAX_LENGTH, pushOption);
  }

  for (const variant of row.bundle.variants) {
    // 조합도 접합 단계에서 물리 행번호를 잃는다 — '조합' 열 값(예: 'RED-M')으로 식별한다.
    const combo = (variant.combination ?? '').trim() || '(빈 조합)';
    const pushVariant: Push = (message) =>
      errors.push({ sheet: '조합', rowNumber: 0, message: `[조합 ${combo}] ${message}` });

    checkMaxLength(variant, VARIANT_MAX_LENGTH, pushVariant);

    const vp = parsePriceCells(variant, ctx, pushVariant);
    if (ctx.pricingEditable) {
      // 조합 자체 칸이 채워졌을 때만 0원 여부를 판단한다(선례: product-import.validator.ts:185-189
      // 의 `if (override.basePriceRaw !== '')` 와 같은 조건 — 상속된 축까지 0원이라 단정하지 않는다).
      if (vp.base !== undefined && vp.base <= 0) {
        pushVariant(`${label('basePrice')}는 0보다 큰 숫자여야 합니다: ${vp.baseRaw}`);
      }

      // 조합에 오버라이드가 없는 축은 상품 값을 상속한다(선례: product-import.validator.ts:202
      // 의 validateVariantOverrides 와 동일한 상속 규약) — 상속 축까지 비교해야 "조합엔 낮은
      // 멤버십가만 적혀 있고 판매가는 상품 값을 그대로 쓰는" 조합이 회원에게 더 비싸게
      // 팔리는 채로 새지 않는다("회원이 더 비싸게 사는 조합이 게시된다" — 조용히 틀리는
      // 부류라 아무도 오류를 못 본다). 수정 행에서 상품 칸이 비어(=변경 없음) 상속할 값이
      // 없으면(둘 다 undefined) 비교하지 않는다 — 그 경우 실제 판매가는 기존 활성 버전에
      // 있고 이 함수는 워크북 문자열만 본다는 한계를 그대로 남긴다.
      const effectiveBase = vp.base ?? base;
      const effectiveMember = vp.member ?? member;
      if (effectiveMember !== undefined && effectiveBase !== undefined && effectiveMember > effectiveBase) {
        pushVariant(
          `${label('membershipPrice')}는 ${label('basePrice')} 이하여야 합니다: ${effectiveMember} > ${effectiveBase}`,
        );
      }
    }
  }

  const salesStartDate = validateSalesDate(product.salesStartDate ?? '', 'salesStartDate', false, pushProduct);
  const salesEndDate = validateSalesDate(product.salesEndDate ?? '', 'salesEndDate', true, pushProduct);
  if (salesStartDate !== undefined && salesEndDate !== undefined && salesStartDate >= salesEndDate) {
    // 둘 다 toISOString() 결과(Z 고정·같은 자릿수)라 사전순 비교 = 시간순 비교다.
    pushProduct(`${label('salesEndDate')}는 ${label('salesStartDate')}보다 뒤여야 합니다.`);
  }

  const constraint = row.bundle.constraint;
  if (constraint) {
    const requiresMembershipRaw = (constraint.requiresMembership ?? '').trim();
    if (requiresMembershipRaw !== '' && requiresMembershipRaw !== 'Y' && requiresMembershipRaw !== 'N') {
      pushConstraint(`${label('requiresMembership')}는 Y 또는 N 이어야 합니다: ${requiresMembershipRaw}`);
    }

    // 컬럼이 진짜 Postgres integer(최대 POSTGRES_INTEGER_MAX)라 상한 없이 통과시키면 프리뷰는
    // 지나가고 commit 에서 22003(numeric_value_out_of_range)로 그 행만 죽는다 — minQuantity/
    // maxQuantity 와 같은 이유로 같은 상수를 쓴다.
    parseIntInRange(
      constraint.lifetimeQuantityLimit ?? '',
      'lifetimeQuantityLimit',
      1,
      POSTGRES_INTEGER_MAX,
      pushConstraint,
    );
  }

  return errors;
}
