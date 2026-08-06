'use client';

// 배송비 그룹 API 클라이언트 (Medusa 커스텀 admin 엔드포인트)
//
// 그룹 정의(금액·무료 기준·지역 추가비)의 단일 진실은 Medusa 의 배송옵션이다.
// Core 상품에는 그룹 코드만 저장된다.

import { MEDUSA_BASE_URL } from '@/const';
import { client } from '../../client';

export const SHIPPING_FEE_TYPES = [
  'free',
  'flat',
  'conditional_free',
  'per_quantity',
] as const;

export type ShippingFeeType = (typeof SHIPPING_FEE_TYPES)[number];

export const SHIPPING_FEE_TYPE_LABELS: Record<ShippingFeeType, string> = {
  free: '배송비 무료',
  flat: '고정 배송비',
  conditional_free: '구매 금액에 따른 부과',
  per_quantity: '상품 수량에 비례하여 부과',
};

export interface ShippingFeePolicy {
  type: ShippingFeeType;
  baseFee: number;
  freeThreshold?: number;
  /** 지역별 배송비 템플릿에서 복사돼 온 값(읽기 전용). 수정은 템플릿에서 한다. */
  jejuExtraFee?: number;
  islandExtraFee?: number;
}

/** 배송 안내용 정보. 배송비 계산에는 영향이 없고 상품 상세에 그대로 표시된다. */
export interface ShippingGroupDelivery {
  method: string;
  area: string;
  leadTimeMinDays: number;
  leadTimeMaxDays: number;
}

export interface ShippingGroup {
  code: string;
  name: string;
  policy: ShippingFeePolicy;
  areaTemplateCode?: string;
  delivery: ShippingGroupDelivery;
  shippingProfileId: string;
  shippingOptionId: string;
}

export interface ShippingGroupPayload {
  code: string;
  name: string;
  policy: ShippingFeePolicy;
  areaTemplateCode?: string;
  delivery: ShippingGroupDelivery;
}

export interface ShippingAreaTemplate {
  code: string;
  name: string;
  jejuExtraFee: number;
  islandExtraFee: number;
}

export const DEFAULT_SHIPPING_GROUP_CODE = 'default';
export const DEFAULT_AREA_TEMPLATE_CODE = 'default';

export const DEFAULT_SHIPPING_GROUP_DELIVERY: ShippingGroupDelivery = {
  method: '택배',
  area: '전국지역',
  leadTimeMinDays: 2,
  leadTimeMaxDays: 3,
};

export const SHIPPING_METHODS = ['택배', '빠른등기', '직접배송', '화물배송', '퀵배송'] as const;

export const medusaShippingGroupsApi = {
  list: async (): Promise<ShippingGroup[]> => {
    const res = await client.get<{ shipping_groups: ShippingGroup[] }>(
      `${MEDUSA_BASE_URL}/admin/shipping-groups`
    );
    return res.data.shipping_groups;
  },

  create: async (payload: ShippingGroupPayload): Promise<ShippingGroup> => {
    const res = await client.post<{ shipping_group: ShippingGroup }>(
      `${MEDUSA_BASE_URL}/admin/shipping-groups`,
      payload
    );
    return res.data.shipping_group;
  },

  update: async (
    code: string,
    payload: Omit<ShippingGroupPayload, 'code'>
  ): Promise<ShippingGroup> => {
    const res = await client.post<{ shipping_group: ShippingGroup }>(
      `${MEDUSA_BASE_URL}/admin/shipping-groups/${encodeURIComponent(code)}`,
      payload
    );
    return res.data.shipping_group;
  },

  delete: async (code: string): Promise<void> => {
    await client.delete(
      `${MEDUSA_BASE_URL}/admin/shipping-groups/${encodeURIComponent(code)}`
    );
  },
};

export const medusaShippingAreaTemplatesApi = {
  list: async (): Promise<ShippingAreaTemplate[]> => {
    const res = await client.get<{
      shipping_area_templates: ShippingAreaTemplate[];
    }>(`${MEDUSA_BASE_URL}/admin/shipping-area-templates`);
    return res.data.shipping_area_templates;
  },

  upsert: async (payload: ShippingAreaTemplate): Promise<ShippingAreaTemplate> => {
    const res = await client.post<{ shipping_area_template: ShippingAreaTemplate }>(
      `${MEDUSA_BASE_URL}/admin/shipping-area-templates`,
      payload
    );
    return res.data.shipping_area_template;
  },

  delete: async (code: string): Promise<void> => {
    await client.delete(
      `${MEDUSA_BASE_URL}/admin/shipping-area-templates/${encodeURIComponent(code)}`
    );
  },
};
