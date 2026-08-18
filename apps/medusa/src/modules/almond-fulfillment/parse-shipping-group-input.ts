import { MedusaError } from '@medusajs/framework/utils';

import {
  DEFAULT_AREA_TEMPLATE_CODE,
  DEFAULT_SHIPPING_GROUP_CODE,
  DEFAULT_SHIPPING_GROUP_DELIVERY,
  type ShippingAreaTemplate,
  type ShippingFeePolicy,
  type ShippingFeeType,
  type ShippingGroup,
  type ShippingGroupDelivery,
} from './types';

const FEE_TYPES: ShippingFeeType[] = ['free', 'flat', 'conditional_free', 'per_quantity'];
const CODE_PATTERN = /^[a-z0-9][a-z0-9-]{0,49}$/;
const MAX_LEAD_TIME_DAYS = 60;

function bad(message: string): never {
  throw new MedusaError(MedusaError.Types.INVALID_DATA, message);
}

function readAmount(value: unknown, field: string): number {
  if (value === undefined || value === null || value === '') return 0;
  const amount = typeof value === 'string' ? Number(value) : value;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) {
    bad(`${field} 는 0 이상의 정수여야 합니다.`);
  }
  return amount;
}

function readDays(value: unknown, field: string, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const days = typeof value === 'string' ? Number(value) : value;
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > MAX_LEAD_TIME_DAYS) {
    bad(`${field} 는 0 이상 ${MAX_LEAD_TIME_DAYS} 이하의 정수여야 합니다.`);
  }
  return days;
}

function parseDelivery(raw: Record<string, unknown>): ShippingGroupDelivery {
  const method = String(raw.method ?? '').trim() || DEFAULT_SHIPPING_GROUP_DELIVERY.method;
  const area = String(raw.area ?? '').trim() || DEFAULT_SHIPPING_GROUP_DELIVERY.area;
  const leadTimeMinDays = readDays(
    raw.leadTimeMinDays,
    'delivery.leadTimeMinDays',
    DEFAULT_SHIPPING_GROUP_DELIVERY.leadTimeMinDays,
  );
  const leadTimeMaxDays = readDays(
    raw.leadTimeMaxDays,
    'delivery.leadTimeMaxDays',
    DEFAULT_SHIPPING_GROUP_DELIVERY.leadTimeMaxDays,
  );
  if (leadTimeMinDays > leadTimeMaxDays) {
    bad('배송기간은 시작일이 종료일보다 클 수 없습니다.');
  }
  const carrier = String(raw.carrier ?? '').trim();
  return { method, area, leadTimeMinDays, leadTimeMaxDays, carrier };
}

const MAX_DESCRIPTION_LENGTH = 500;

function parseDescription(value: unknown): string {
  if (value === undefined || value === null) return '';
  const description = String(value).trim();
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    bad(`description 은 ${MAX_DESCRIPTION_LENGTH}자 이내여야 합니다.`);
  }
  return description;
}

export function parseShippingGroupInput(body: unknown, codeFromPath?: string): ShippingGroup {
  const input = (body ?? {}) as Record<string, unknown>;
  const code = String(codeFromPath ?? input.code ?? '').trim();
  const name = String(input.name ?? '').trim();

  if (!CODE_PATTERN.test(code)) {
    bad('code 는 영소문자·숫자·하이픈 50자 이내여야 합니다.');
  }
  if (!name) {
    bad('name 은 필수입니다.');
  }

  const rawPolicy = (input.policy ?? {}) as Record<string, unknown>;
  const type = rawPolicy.type as ShippingFeeType;
  if (!FEE_TYPES.includes(type)) {
    bad(`policy.type 은 ${FEE_TYPES.join(' | ')} 중 하나여야 합니다.`);
  }

  // 모든 필드를 항상 채운다. shipping option 의 data 갱신은 JSON 병합이라, 빠뜨린 키는
  // 옛 값이 그대로 남는다 (조건부 무료 → 고정 으로 바꿔도 옛 freeThreshold 가 살아남는다).
  const policy: ShippingFeePolicy = {
    type,
    baseFee: readAmount(rawPolicy.baseFee, 'policy.baseFee'),
    freeThreshold: 0,
  };

  if (type === 'conditional_free') {
    const freeThreshold = readAmount(rawPolicy.freeThreshold, 'policy.freeThreshold');
    if (freeThreshold <= 0) {
      bad('조건부 무료배송은 policy.freeThreshold 가 1원 이상이어야 합니다.');
    }
    policy.freeThreshold = freeThreshold;
  }

  if ((type === 'flat' || type === 'conditional_free' || type === 'per_quantity') && policy.baseFee <= 0) {
    bad('policy.baseFee 는 1원 이상이어야 합니다. 배송비를 받지 않으려면 type 을 free 로 지정하세요.');
  }

  const rawAreaTemplateCode = input.areaTemplateCode;
  const areaTemplateCode =
    rawAreaTemplateCode === null || rawAreaTemplateCode === ''
      ? undefined
      : String(rawAreaTemplateCode ?? DEFAULT_AREA_TEMPLATE_CODE).trim();
  if (areaTemplateCode && !CODE_PATTERN.test(areaTemplateCode)) {
    bad('areaTemplateCode 는 영소문자·숫자·하이픈 50자 이내여야 합니다.');
  }

  return {
    code,
    name,
    policy,
    areaTemplateCode,
    delivery: parseDelivery((input.delivery ?? {}) as Record<string, unknown>),
    description: parseDescription(input.description),
  };
}

export function parseAreaTemplateInput(body: unknown, codeFromPath?: string): ShippingAreaTemplate {
  const input = (body ?? {}) as Record<string, unknown>;
  const code = String(codeFromPath ?? input.code ?? '').trim();
  const name = String(input.name ?? '').trim();

  if (!CODE_PATTERN.test(code)) {
    bad('code 는 영소문자·숫자·하이픈 50자 이내여야 합니다.');
  }
  if (!name) {
    bad('name 은 필수입니다.');
  }

  return {
    code,
    name,
    jejuExtraFee: readAmount(input.jejuExtraFee, 'jejuExtraFee'),
    islandExtraFee: readAmount(input.islandExtraFee, 'islandExtraFee'),
  };
}

export function assertDeletableShippingGroup(code: string): void {
  if (code === DEFAULT_SHIPPING_GROUP_CODE) {
    bad('기본 배송비 그룹은 삭제할 수 없습니다.');
  }
}
