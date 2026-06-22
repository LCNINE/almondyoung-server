'use client';

// Medusa Customer 도메인 API 클라이언트

import { MEDUSA_BASE_URL } from '@/const';
import type {
  CustomerCartResponse,
  MedusaCustomerListQuery,
  MedusaOrderListQuery,
} from '@/lib/types/dto/medusa';
import type {
  AdminCustomerListResponse,
  AdminCustomerResponse,
  AdminOrderListResponse,
  AdminOrderResponse,
} from '@medusajs/types';
import { client } from '../../client';

// 컴포넌트에서 사용하는 Medusa 엔티티 타입 재노출
export type {
  AdminCustomer,
  AdminCustomerAddress,
  AdminOrder,
} from '@medusajs/types';

export const medusaCustomerApi = {
  // 고객 목록 조회
  getCustomers: async (
    query: MedusaCustomerListQuery = {}
  ): Promise<AdminCustomerListResponse> => {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.append('limit', String(query.limit));
    if (query.offset !== undefined)
      params.append('offset', String(query.offset));
    if (query.q) params.append('q', query.q);
    if (query.order) params.append('order', query.order);

    const qs = params.toString();

    const response = await client.get<AdminCustomerListResponse>(
      `${MEDUSA_BASE_URL}/admin/customers${qs ? `?${qs}` : ''}`
    );
    return response.data;
  },

  // 고객 상세 조회 (주소 포함)
  getCustomerById: async (id: string): Promise<AdminCustomerResponse> => {
    const response = await client.get<AdminCustomerResponse>(
      `${MEDUSA_BASE_URL}/admin/customers/${id}?fields=*addresses`
    );
    return response.data;
  },

  // 이메일로 고객 검색
  getCustomerByEmail: async (
    email: string
  ): Promise<AdminCustomerListResponse> => {
    const response = await client.get<AdminCustomerListResponse>(
      `${MEDUSA_BASE_URL}/admin/customers?email=${encodeURIComponent(email)}&limit=1`
    );
    return response.data;
  },

  // 고객의 활성 장바구니 조회 (커스텀 admin 엔드포인트)
  getCustomerCart: async (
    customerId: string
  ): Promise<CustomerCartResponse> => {
    const response = await client.get<CustomerCartResponse>(
      `${MEDUSA_BASE_URL}/admin/customers/${customerId}/cart`
    );
    return response.data;
  },
};

// 주문 목록 조회 시 가져올 필드 (그리드 컬럼 + 품목별 뷰를 위해 items / 결제수단 / 판매채널 포함)
const ORDER_LIST_FIELDS = [
  'id',
  'display_id',
  'status',
  'payment_status',
  'fulfillment_status',
  'item_subtotal',
  'item_total',
  'total',
  'subtotal',
  'discount_total',
  'currency_code',
  'email',
  'created_at',
  'sales_channel.name',
  'payment_collections.payments.provider_id',
  'payment_collections.payments.amount',
  'items.id',
  'items.title',
  'items.subtitle',
  'items.thumbnail',
  'items.product_title',
  'items.product_handle',
  'items.variant_sku',
  'items.variant_title',
  'items.quantity',
  'items.unit_price',
  'items.total',
  'items.detail.quantity',
  'items.detail.fulfilled_quantity',
  'items.detail.shipped_quantity',
  'items.detail.delivered_quantity',
].join(',');

// 주문 상세 조회 시 가져올 필드 (라인 아이템 / 배송지 / 금액 포함)
const ORDER_DETAIL_FIELDS = [
  'id',
  'display_id',
  'status',
  'payment_status',
  'fulfillment_status',
  'total',
  'subtotal',
  'shipping_total',
  'discount_total',
  'tax_total',
  'currency_code',
  'email',
  'created_at',
  'items.id',
  'items.title',
  'items.subtitle',
  'items.thumbnail',
  'items.product_title',
  'items.variant_title',
  'items.quantity',
  'items.unit_price',
  'items.total',
  '*shipping_address',
].join(',');

export const medusaOrderApi = {
  // 고객 ID로 주문 목록 조회 (최신순)
  getOrdersByCustomerId: async (
    customerId: string,
    query: Omit<MedusaOrderListQuery, 'customer_id'> = {}
  ): Promise<AdminOrderListResponse> => {
    const params = new URLSearchParams();
    params.append('customer_id', customerId);
    params.append('order', query.order ?? '-created_at');
    params.append('limit', String(query.limit ?? 20));
    if (query.offset !== undefined)
      params.append('offset', String(query.offset));
    if (query.createdAtGte)
      params.append('created_at[$gte]', query.createdAtGte);
    if (query.createdAtLte)
      params.append('created_at[$lte]', query.createdAtLte);
    params.append('fields', ORDER_LIST_FIELDS);

    const response = await client.get<AdminOrderListResponse>(
      `${MEDUSA_BASE_URL}/admin/orders?${params.toString()}`
    );
    return response.data;
  },

  // 주문 단건 상세 조회
  getOrderById: async (orderId: string): Promise<AdminOrderResponse> => {
    const params = new URLSearchParams();
    params.append('fields', ORDER_DETAIL_FIELDS);

    const response = await client.get<AdminOrderResponse>(
      `${MEDUSA_BASE_URL}/admin/orders/${orderId}?${params.toString()}`
    );
    return response.data;
  },
};
