import { Injectable } from '@nestjs/common';
import { ProductRecord } from '../dto/import.types';

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

@Injectable()
export class ProductImportValidator {
  validate(records: ProductRecord[]): ProductRecord[] {
    for (const record of records) {
      // 고아 옵션 stub 등 productKey 만 있는 레코드(raw 비어있음)는 필드 검증 skip
      if (Object.keys(record.raw).length === 0) continue;
      this.validateFields(record);
      this.validateOptions(record);
      this.validateVariantOverrides(record);
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

    version.isOverseas = this.bool(raw.isOverseas);
    version.isVisibleToMembersOnly = this.bool(raw.isVisibleToMembersOnly);
    version.hideMembershipPriceForNonMembers = this.bool(raw.hideMembershipPriceForNonMembers);

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

  private bool(raw: string | undefined): boolean {
    const value = (raw ?? '').trim().toLowerCase();
    return value === 'y' || value === 'true' || value === '1';
  }
}
