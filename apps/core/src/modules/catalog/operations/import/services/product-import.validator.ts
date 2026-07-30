import { Injectable } from '@nestjs/common';
import { ProductRecord, parseBoolCell, formatKstMinutes } from '../dto/import.types';

export const MAX_VARIANT_COMBINATIONS = 100;

const PRODUCT_TYPES = ['regular_sale', 'limited_edition'];
const FULFILLMENT_KINDS = ['physical', 'digital'];

const STRING_FIELDS = [
  'productCode',
  'name',
  'alternativeName',
  'description',
  'brand',
  'material',
  'salesClassification',
  'purchaseClassification',
  'seller',
];

const SALES_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const SALES_DATE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
/**
 * 날짜만 적힌 칸을 KST 경계로 해석한다. UTC 로 읽으면 "8월 31일까지 판매"가 그날
 * 09:00(KST) 에 끝나 SALES_ENDED 로 조용히 품절된다 — MD 는 KST 로 생각한다.
 * KST 는 DST 가 없어 오프셋이 항상 +09:00 이므로 문자열에 박아 넣으면 서버 TZ 와 무관해진다.
 */
const KST_OFFSET = '+09:00';

@Injectable()
export class ProductImportValidator {
  validate(records: ProductRecord[]): ProductRecord[] {
    for (const record of records) {
      // 고아 옵션 stub 등 productKey 만 있는 레코드(raw 비어있음)는 필드 검증 skip
      if (Object.keys(record.raw).length === 0) continue;
      this.validateFields(record);
      this.validateOptions(record);
      this.validateVariantOverrides(record);
      this.validatePurchaseConstraint(record);
    }
    return records;
  }

  private validateFields(record: ProductRecord): void {
    const raw = record.raw;
    const errors = record.errors;
    const version: Record<string, unknown> = {};
    const push = (message: string) => errors.push({ sheet: 'Products', rowNumber: record.rowNumber, message });

    if (!record.productKey || record.productKey.trim() === '') push('productKey 는 필수입니다.');

    const name = (raw.name ?? '').trim();
    if (name === '') push('name 은 필수입니다.');
    else version.name = name;

    for (const field of STRING_FIELDS) {
      if (field === 'name') continue;
      const value = (raw[field] ?? '').trim();
      if (value !== '') version[field] = value;
    }

    version.marketPrice = this.optionalMoney(raw.marketPrice, 'marketPrice', push);
    version.supplyPrice = this.optionalMoney(raw.supplyPrice, 'supplyPrice', push);

    // 판매가는 pricing rules 로 들어가므로 version 스칼라가 아니다.
    // 필수로 두는 이유가 둘이다: (1) pricingRulesSetSchema 가 order 1 all_variants
    // base_price 규칙을 요구한다 (2) 없으면 계산기가 0 을 내고 validateCalculatedPrices
    // 가 0 을 통과시켜 0원 상품이 스토어프론트까지 나간다.
    const basePrice = this.optionalIntegerMoney(raw.basePrice, 'basePrice', push);
    if (basePrice === undefined || basePrice <= 0) {
      push('basePrice 는 0보다 큰 숫자여야 합니다 (판매가 없이 게시할 수 없습니다).');
    } else {
      record.basePrice = basePrice;
    }

    const membershipPrice = this.optionalIntegerMoney(raw.membershipPrice, 'membershipPrice', push);
    if (membershipPrice !== undefined) {
      if (typeof record.basePrice === 'number' && membershipPrice > record.basePrice) {
        push(`membershipPrice 는 basePrice 이하여야 합니다: ${membershipPrice} > ${record.basePrice}`);
      } else {
        record.membershipPrice = membershipPrice;
      }
    }

    version.ageRestriction = this.intInRange(raw.ageRestriction, 'ageRestriction', 0, 100, 0, push);
    version.minQuantity = this.intInRange(raw.minQuantity, 'minQuantity', 1, Number.MAX_SAFE_INTEGER, 1, push);
    const maxRaw = (raw.maxQuantity ?? '').trim();
    if (maxRaw !== '') {
      const max = this.intInRange(raw.maxQuantity, 'maxQuantity', 1, Number.MAX_SAFE_INTEGER, undefined, push);
      if (typeof max === 'number' && typeof version.minQuantity === 'number' && max < version.minQuantity) {
        push('maxQuantity 는 minQuantity 이상이어야 합니다.');
      }
      version.maxQuantity = max;
    }

    version.productType = this.enumOrDefault(raw.productType, 'productType', PRODUCT_TYPES, 'regular_sale', push);
    version.fulfillmentKind = this.enumOrDefault(
      raw.fulfillmentKind,
      'fulfillmentKind',
      FULFILLMENT_KINDS,
      'physical',
      push,
    );

    const seoTitle = (raw.seoTitle ?? '').trim();
    if (seoTitle !== '') {
      // seo_title 은 varchar(255) 다. 넘겨도 프리뷰는 통과하고 commit 에서 Postgres 22001 로
      // 그 행만 죽는다 — basePrice 를 입구에서 막는 것과 같은 이유로 여기서 막는다.
      if (seoTitle.length > 255) push(`seoTitle 은 255자 이하여야 합니다 (현재 ${seoTitle.length}자).`);
      else version.seoTitle = seoTitle;
    }

    const seoDescription = (raw.seoDescription ?? '').trim();
    if (seoDescription !== '') version.seoDescription = seoDescription;

    // seo_keywords 는 text[] 다. 구분자는 optionValues 와 같은 '|' 로 맞춘다.
    const seoKeywords = (raw.seoKeywords ?? '')
      .split('|')
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword !== '');
    if (seoKeywords.length > 0) version.seoKeywords = seoKeywords;

    version.isOverseas = this.bool(raw.isOverseas);
    version.isVisibleToMembersOnly = this.bool(raw.isVisibleToMembersOnly);
    version.hideMembershipPriceForNonMembers = this.bool(raw.hideMembershipPriceForNonMembers);
    version.isWholesaleOnly = this.bool(raw.isWholesaleOnly);

    // ISO 문자열로 둔다 — payload jsonb 왕복에서 Date 는 문자열이 되므로 version 에 Date 를
    // 넣으면 워커가 문자열을 drizzle timestamp 컬럼에 그대로 넘겨 TypeError 로 그 행이 죽는다.
    // Date 로 되살리는 지점은 ProductImportManager.createFromRecord 한 곳이다.
    const salesStartDate = this.salesDate(raw.salesStartDate, 'salesStartDate', false, push);
    const salesEndDate = this.salesDate(raw.salesEndDate, 'salesEndDate', true, push);
    if (salesStartDate !== undefined && salesEndDate !== undefined && salesStartDate >= salesEndDate) {
      // 둘 다 toISOString() 결과(Z 고정·같은 자릿수)라 사전순 비교 = 시간순 비교다.
      // 이 필드는 등록 후 화면에서 고칠 수 없으므로 MD 가 워크북에서 무엇이 해석됐는지
      // 바로 보게 KST 로 렌더링해 echo 한다(원본 입력도 KST 였다).
      push(
        `salesEndDate 는 salesStartDate 보다 뒤여야 합니다: ${formatKstMinutes(salesEndDate)} <= ${formatKstMinutes(salesStartDate)}`,
      );
    } else {
      record.salesStartDate = salesStartDate;
      record.salesEndDate = salesEndDate;
    }

    record.version = version;
  }

  private validateOptions(record: ProductRecord): void {
    const seenNames = new Set<string>();
    const seenSortOrders = new Set<number>();
    let combinations = 1;
    for (const option of record.options) {
      const push = (message: string) => record.errors.push({ sheet: 'Options', rowNumber: record.rowNumber, message });
      if (option.displayName.trim() === '') push('optionName 은 필수입니다.');
      if (seenNames.has(option.displayName)) push(`옵션명 중복: ${option.displayName}`);
      seenNames.add(option.displayName);

      // 명시 sortOrder 와 공란 fallback(등장 순서) 이 우연히 같은 값으로 충돌할 수 있다 —
      // 둘 다 여기서 동일하게 걸러낸다 (normalizer 는 출처를 구분하지 않고 값만 넘긴다).
      if (seenSortOrders.has(option.sortOrder)) push(`sortOrder 중복: ${option.sortOrder}`);
      seenSortOrders.add(option.sortOrder);

      if (option.values.length === 0) push(`옵션값이 비어있습니다: ${option.displayName}`);
      const seenValues = new Set<string>();
      for (const v of option.values) {
        if (seenValues.has(v.displayName)) push(`옵션값 중복: ${option.displayName}=${v.displayName}`);
        seenValues.add(v.displayName);
      }
      combinations *= Math.max(option.values.length, 1);
    }
    if (combinations > MAX_VARIANT_COMBINATIONS) {
      record.errors.push({
        sheet: 'Options',
        rowNumber: record.rowNumber,
        message: `variant 조합 수(${combinations})가 상한(${MAX_VARIANT_COMBINATIONS})을 초과했습니다.`,
      });
    }
  }

  private validateVariantOverrides(record: ProductRecord): void {
    for (const override of record.variantOverrides) {
      const push = (message: string) =>
        record.errors.push({ sheet: 'Variants', rowNumber: override.rowNumber, message });

      if (override.basePriceRaw !== '') {
        const value = this.optionalIntegerMoney(override.basePriceRaw, 'basePrice', push);
        if (value === undefined || value <= 0) push('basePrice 는 0보다 큰 숫자여야 합니다.');
        else override.basePrice = value;
      }
      if (override.membershipPriceRaw !== '') {
        const value = this.optionalIntegerMoney(override.membershipPriceRaw, 'membershipPrice', push);
        if (value === undefined || value <= 0) push('membershipPrice 는 0보다 큰 숫자여야 합니다.');
        else override.membershipPrice = value;
      }

      // 이 조합에 basePrice/membershipPrice 오버라이드가 없으면 Products 시트의 기본가를
      // 상속한다 — 양쪽 축 모두 상속해야 한다. basePrice 만 오버라이드하고 membershipPrice 를
      // 비워둔 행은 상품의 membershipPrice 가 그대로 적용되므로(builder 가 override 가 없으면
      // all_variants 규칙을 그대로 태운다), 여기서도 상속된 값으로 비교해야 실제 계산 결과와
      // 일치한다 — 안 그러면 오버라이드된 basePrice 보다 상품 membershipPrice 가 더 커도
      // 이 검증을 통과해 회원이 더 비싸게 사는 조합이 게시된다.
      const base = override.basePrice ?? record.basePrice;
      const member = override.membershipPrice ?? record.membershipPrice;
      if (typeof base === 'number' && typeof member === 'number' && member > base) {
        push(`membershipPrice 는 basePrice 이하여야 합니다: ${member} > ${base}`);
      }
    }
  }

  private validatePurchaseConstraint(record: ProductRecord): void {
    const raw = record.purchaseConstraintRaw;
    if (!raw) return;
    const push = (message: string) => record.errors.push({ sheet: 'Constraints', rowNumber: raw.rowNumber, message });

    const requiresMembership = parseBoolCell(raw.requiresMembershipRaw);

    let lifetimeQuantityLimit: number | null = null;
    if (raw.lifetimeQuantityLimitRaw !== '') {
      const parsed = Number(raw.lifetimeQuantityLimitRaw);
      // 컬럼이 integer(최대 2147483647)라 상한 없이 통과시키면 프리뷰는 지나가고
      // commit 에서 Postgres 22003(numeric_value_out_of_range)로 그 행만 죽는다 —
      // 위 seoTitle 255자 가드와 같은 이유로 여기서 미리 막는다.
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 2_147_483_647) {
        push(`lifetimeQuantityLimit 는 1 이상 2147483647 이하의 정수여야 합니다: ${raw.lifetimeQuantityLimitRaw}`);
        return;
      }
      lifetimeQuantityLimit = parsed;
    }

    // 둘 다 비어 있으면 "제약 없음"이고, 그 입력은 upsertForVersion 의 isDeleteIntent 가
    // **삭제**로 해석한다(product-purchase-constraints.service.ts:32-34). 신규 생성엔 지울
    // 것이 없으니 호출 자체를 하지 않는 것이 맞다 — 그래서 undefined 로 남긴다.
    if (!requiresMembership && lifetimeQuantityLimit === null) return;

    record.purchaseConstraint = { requiresMembership, lifetimeQuantityLimit };
  }

  private optionalMoney(raw: string | undefined, field: string, push: (m: string) => void): number | undefined {
    const value = (raw ?? '').trim();
    if (value === '') return undefined;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      push(`${field} 는 0 이상의 숫자여야 합니다: ${value}`);
      return undefined;
    }
    return n;
  }

  // pricing rules 로 들어가는 필드(basePrice/membershipPrice, product-level + override) 전용.
  // pricingRulesSetSchema 의 operationValue 가 z.number().int() 라 소수는 preview 는 통과하고
  // commit(=규칙 저장) 에서 Zod 파싱 실패로 죽는다 — 원화는 소수 단위가 없으므로 여기서 미리 막는다.
  // marketPrice/supplyPrice 는 pricing rules 로 가지 않으므로 optionalMoney 를 그대로 쓴다.
  private optionalIntegerMoney(raw: string | undefined, field: string, push: (m: string) => void): number | undefined {
    const value = this.optionalMoney(raw, field, push);
    if (value === undefined) return undefined;
    if (!Number.isInteger(value)) {
      push(`${field} 는 정수여야 합니다 (원화는 소수 단위가 없습니다): ${value}`);
      return undefined;
    }
    return value;
  }

  private intInRange(
    raw: string | undefined,
    field: string,
    min: number,
    max: number,
    fallback: number | undefined,
    push: (m: string) => void,
  ): number | undefined {
    const value = (raw ?? '').trim();
    if (value === '') return fallback;
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) {
      push(`${field} 는 ${min}~${max === Number.MAX_SAFE_INTEGER ? '∞' : max} 범위의 정수여야 합니다: ${value}`);
      return fallback;
    }
    return n;
  }

  private enumOrDefault(
    raw: string | undefined,
    field: string,
    allowed: string[],
    fallback: string,
    push: (m: string) => void,
  ): string {
    const value = (raw ?? '').trim();
    if (value === '') return fallback;
    if (!allowed.includes(value)) {
      push(`${field} 는 [${allowed.join(', ')}] 중 하나여야 합니다: ${value}`);
      return fallback;
    }
    return value;
  }

  /**
   * 'YYYY-MM-DD' 또는 'YYYY-MM-DD HH:mm' 을 KST 로 해석해 ISO8601(UTC) 문자열로 돌려준다.
   *
   * 느슨한 `new Date(문자열)` 을 쓰지 않는 이유: '08/01/2026' 같은 입력을 구현 재량으로
   * 조용히 해석해 MD 의 의도와 다른 날짜가 게시된다. 형식을 좁히고 명시적으로 거부한다.
   * (엑셀 날짜 서식 셀은 파서가 이미 이 두 형식으로 정규화한다 — product-import.parser.ts)
   *
   * endOfDay 는 종료일 전용이다. 날짜만 주면 그 날 23:59:59.999(KST)까지 판매한다는 뜻이다.
   */
  private salesDate(
    raw: string | undefined,
    field: string,
    endOfDay: boolean,
    push: (m: string) => void,
  ): string | undefined {
    const value = (raw ?? '').trim();
    if (value === '') return undefined;

    let iso: string;
    if (SALES_DATE_ONLY.test(value)) {
      iso = `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}${KST_OFFSET}`;
    } else if (SALES_DATE_TIME.test(value)) {
      iso = `${value.replace(' ', 'T')}:00.000${KST_OFFSET}`;
    } else {
      push(`${field} 는 'YYYY-MM-DD' 또는 'YYYY-MM-DD HH:mm' 형식이어야 합니다: ${value}`);
      return undefined;
    }

    // new Date(iso) 는 일(day) 오버플로를 다음 달로 조용히 굴려 보낸다(예: '2026-02-30' →
    // 2026-03-02) — NaN 이 되지 않으므로 아래 Number.isNaN 만으로는 못 잡는다. 두 형식 모두
    // 'YYYY-MM-DD' 로 시작하므로 고정 위치에서 잘라 달력 유효성을 먼저 확인한다. 월(1~12)·
    // 시(0~23)·분(0~59) 범위 오버플로는 ISO 문자열 파싱 단계에서 이미 NaN 으로 걸러진다.
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    if (!this.isValidCalendarDate(year, month, day)) {
      push(`${field} 는 존재하지 않는 날짜입니다: ${value}`);
      return undefined;
    }

    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) {
      // 정규식은 통과하지만 존재하지 않는 시각이다. ECMAScript 는 24:00 을 다음날 00:00 으로
      // 허용하므로(예: '2026-08-01T24:00:00+09:00' 는 8월 2일 00:00 KST 로 파싱된다) 24:00
      // 자체는 여기서 걸리지 않는다 — 24:01 이상이나 분 60 이상 같은 진짜 오버플로만 NaN 이 된다.
      push(`${field} 는 존재하지 않는 날짜입니다: ${value}`);
      return undefined;
    }
    return parsed.toISOString();
  }

  /**
   * Date.UTC 왕복으로 실재하지 않는 날짜(2026-02-30, 4월 31일 등)를 잡아낸다 — day 오버플로는
   * new Date(ISO 문자열) 이 조용히 다음 달로 넘겨버려 NaN 이 되지 않으므로 별도 검증이 필요하다.
   * UTC 만 쓰므로 KST 오프셋·서버 TZ 와 무관하다.
   */
  private isValidCalendarDate(year: number, month: number, day: number): boolean {
    const d = new Date(Date.UTC(year, month - 1, day));
    return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
  }

  private bool(raw: string | undefined): boolean {
    return parseBoolCell(raw);
  }
}
