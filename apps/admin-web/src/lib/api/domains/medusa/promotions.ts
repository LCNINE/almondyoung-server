'use client';

import { MEDUSA_BASE_URL } from '@/const';
import { client } from '../../client';

export interface PromotionRule {
  attribute: string;
  operator: string;
  values: string[];
}

export interface PromotionTargetRule {
  // Medusa 라인아이템 컨텍스트 경로. 플랫 키는 매칭 불가 → dotted 경로만 사용.
  attribute:
    | 'items.product.id'
    | 'items.product.categories.id'
    | 'items.product.collection_id'
    | 'items.product.type_id';
  operator: 'in';
  values: string[];
}

export interface MedusaPromotion {
  id: string;
  code: string;
  type: string;
  status: string;
  is_automatic: boolean;
  campaign_id: string | null;
  /**
   * 프로모션 전역 사용 횟수 상한 (Medusa 2.12.0+). campaign budget 과 독립적으로 검사된다.
   * 옛 쿠폰은 이 필드 대신 campaign.budget{type:'usage'} 에 전역 한도를 갖는다 — 둘 다 표시 대상.
   */
  limit?: number | null;
  used?: number;
  campaign?: {
    campaign_identifier: string;
    starts_at: string | null;
    ends_at: string | null;
    budget?: {
      type: string;
      limit: number | null;
      used: number;
    } | null;
  } | null;
  application_method?: {
    id: string;
    type: 'percentage' | 'fixed';
    value: number;
    target_type: 'order' | 'items' | 'shipping_methods';
    currency_code: string | null;
    max_quantity: number | null;
    target_rules?: PromotionTargetRule[];
  } | null;
  rules?: PromotionRule[];
  /**
   * 우리가 `promotion_meta` 에서 합성한 것 — 나머지 알려진 키(`max_claims`·`visibility` 등)는
   * `getCouponMeta` 가 캐스팅해 읽으므로 여기선 이 태스크가 새로 쓰는 유효기간 정책 3필드만
   * 명시한다(#488 결정 1). 인덱스 시그니처로 나머지 키의 존재도 여전히 허용한다.
   */
  metadata?: {
    starts_at?: string | null;
    ends_at?: string | null;
    validity_days?: number | null;
    [key: string]: unknown;
  } | null;
  created_at: string;
  updated_at: string;
}

export interface MedusaPromotionListResponse {
  promotions: MedusaPromotion[];
  count: number;
  offset: number;
  limit: number;
}

export interface CreatePromotionPayload {
  code: string;
  type: 'standard';
  is_automatic: false;
  status?: 'active' | 'inactive' | 'draft';
  /**
   * 프로모션 전역 사용 횟수 상한 (Medusa 2.12.0+).
   * campaign budget 과 독립적으로 검사되므로 1인당 한도(use_by_attribute)와 공존할 수 있다.
   * is_automatic: true 인 프로모션에는 설정할 수 없다 (Medusa 검증기 refine).
   */
  limit?: number;
  application_method: {
    type: 'percentage' | 'fixed';
    value: number;
    target_type: 'order' | 'items' | 'shipping_methods';
    currency_code?: string;
    allocation?: 'each' | 'across' | 'once';
    target_rules?: PromotionTargetRule[];
  };
  campaign?: {
    name: string;
    campaign_identifier: string;
    starts_at?: string;
    ends_at?: string;
    // spend 계열은 금액 기준이라 currency_code 필수
    budget?:
      | { type: 'usage'; limit: number }
      | { type: 'spend'; limit: number; currency_code: string }
      | { type: 'use_by_attribute'; attribute: string; limit: number }
      | { type: 'spend_by_attribute'; attribute: string; limit: number; currency_code: string };
  };
  rules?: PromotionRule[];
  additional_data?: Record<string, unknown>;
}

export interface AssignPromotionResult {
  success: boolean;
  issued: string[];
  skipped: { promotion_id: string; reason: string }[];
  force: boolean;
}

export interface CouponCustomer {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
  issued_at: string;
  /** 발급 인스턴스 모델(#488) 이후 필드 — 이 고객이 가진 grant 장수. */
  granted_count: number;
  used_count: number;
  /** 지금 쓸 수 있는(만료·소진 아닌) 장수. */
  usable_count: number;
  /** 가진 장 중 가장 빠른 만료일. 없으면 null. */
  next_expires_at: string | null;
  /** 가장 최근 발급 경로 (admin_manual / admin_force / …). */
  issued_via: string | null;
}

export interface CouponCustomersResponse {
  promotion_id: string;
  promotion_code: string;
  customers: CouponCustomer[];
  count: number;
  offset: number;
  limit: number;
}

/** `POST /admin/promotions/:id/customers` 응답 (#488 Task 9). */
export interface BulkIssueResult {
  promotion_id: string;
  issued: { customer_id: string; granted: number }[];
  skipped: { customer_id: string; reason: string }[];
  force: boolean;
}

export const medusaPromotionsApi = {
  list: async (params: { limit?: number; offset?: number; q?: string } = {}) => {
    const p = new URLSearchParams();
    if (params.limit !== undefined) p.append('limit', String(params.limit));
    if (params.offset !== undefined) p.append('offset', String(params.offset));
    if (params.q) p.append('q', params.q);
    const qs = p.toString();
    const res = await client.get<MedusaPromotionListResponse>(
      `${MEDUSA_BASE_URL}/admin/promotions${qs ? `?${qs}` : ''}`
    );
    return res.data;
  },

  get: async (id: string) => {
    const res = await client.get<{ promotion: MedusaPromotion }>(
      `${MEDUSA_BASE_URL}/admin/promotions/${id}`
    );
    return res.data.promotion;
  },

  create: async (payload: CreatePromotionPayload) => {
    const res = await client.post<{ promotion: MedusaPromotion }>(
      `${MEDUSA_BASE_URL}/admin/promotions`,
      payload
    );
    return res.data.promotion;
  },

  // Medusa V2: POST /admin/promotions/:id (not PATCH)
  updateStatus: async (id: string, status: 'active' | 'inactive') => {
    const res = await client.post<{ promotion: MedusaPromotion }>(
      `${MEDUSA_BASE_URL}/admin/promotions/${id}`,
      { status }
    );
    return res.data.promotion;
  },

  delete: async (id: string) => {
    await client.delete(`${MEDUSA_BASE_URL}/admin/promotions/${id}`);
  },

  /**
   * 고객 한 명에게 쿠폰 여러 개를 발급한다 (고객축).
   *
   * 🔴 `submitId` 는 **필수다** — 라우트가 없으면 400 을 낸다. 서버가 만들어 주던 시절엔
   * 재도착마다 새 키라 따닥이 곧 두 배 발급이었다. 호출부는 「제출 시작」에 한 번 만들어
   * 재시도 내내 **같은 값**을 보내야 한다(`coupon-assign-dialog.tsx` 의 `submitIdRef` 와
   * 같은 규약). 인자에 기본값을 두지 않는 것은 의도다 — 호출부가 무심코 새 값을 만드는
   * 자리를 남기지 않는다.
   */
  assignToCustomer: async (
    medusaCustomerId: string,
    promotionIds: string[],
    submitId: string,
    force = false,
    quantity?: number,
  ): Promise<AssignPromotionResult> => {
    const res = await client.post<AssignPromotionResult>(
      `${MEDUSA_BASE_URL}/admin/customers/${medusaCustomerId}/promotions`,
      { promotion_ids: promotionIds, submit_id: submitId, force, ...(quantity != null ? { quantity } : {}) }
    );
    return res.data;
  },

  getCustomers: async (promotionId: string, params: { limit?: number; offset?: number } = {}) => {
    const p = new URLSearchParams();
    if (params.limit !== undefined) p.append('limit', String(params.limit));
    if (params.offset !== undefined) p.append('offset', String(params.offset));
    const qs = p.toString();
    const res = await client.get<CouponCustomersResponse>(
      `${MEDUSA_BASE_URL}/admin/promotions/${promotionId}/customers${qs ? `?${qs}` : ''}`
    );
    return res.data;
  },

  revokeFromCustomer: async (promotionId: string, customerIds: string[]) => {
    await client.delete(
      `${MEDUSA_BASE_URL}/admin/promotions/${promotionId}/customers`,
      { data: { customer_ids: customerIds } }
    );
  },

  /** 쿠폰 1개를 고객 N명에게. `submitId` 가 따닥·재시도를 멱등하게 만든다. */
  bulkIssue: async (
    promotionId: string,
    customerIds: string[],
    quantity: number,
    submitId: string,
    force = false,
  ): Promise<BulkIssueResult> => {
    const res = await client.post<BulkIssueResult>(
      `${MEDUSA_BASE_URL}/admin/promotions/${promotionId}/customers`,
      { customer_ids: customerIds, quantity, submit_id: submitId, force },
    );
    return res.data;
  },
};
