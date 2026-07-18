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
    let combinations = 1;
    for (const option of record.options) {
      const push = (message: string) => record.errors.push({ sheet: 'Options', rowNumber: record.rowNumber, message });
      if (option.displayName.trim() === '') push('optionName 은 필수입니다.');
      if (seenNames.has(option.displayName)) push(`옵션명 중복: ${option.displayName}`);
      seenNames.add(option.displayName);

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
