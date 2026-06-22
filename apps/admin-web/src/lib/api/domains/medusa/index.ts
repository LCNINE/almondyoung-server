'use client';

// Medusa Customer 도메인 API 클라이언트

import { MEDUSA_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  AdminCustomer,
  AdminCustomerAddress,
  AdminCustomerResponse,
  AdminCustomerListResponse,
  AdminOrder,
  AdminOrderListResponse,
} from '@medusajs/types';


export type { AdminCustomer, AdminCustomerAddress, AdminOrder };


export interface MedusaCustomerListQuery {
  limit?: number;
  offset?: number;
  q?: string;
  order?: string; // Medusa 형식: "-created_at" (desc), "created_at" (asc)
}

export const medusaCustomerApi = {
  // 고객 목록 조회
  getCustomers: async (
    query: MedusaCustomerListQuery = {}
  ): Promise<AdminCustomerListResponse> => {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.append('limit', String(query.limit));
    if (query.offset !== undefined) params.append('offset', String(query.offset));
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
};

export interface MedusaOrderListQuery {
  customer_id?: string;
  limit?: number;
  offset?: number;
  order?: string; // Medusa 형식: "-created_at" (desc), "created_at" (asc)
}

// 주문 목록 조회 시 가져올 필드 (totals 계산을 위해 items 포함)
const ORDER_LIST_FIELDS = [
  'id',
  'display_id',
  'status',
  'payment_status',
  'fulfillment_status',
  'total',
  'currency_code',
  'email',
  'created_at',
  'items.id',
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
    if (query.offset !== undefined) params.append('offset', String(query.offset));
    params.append('fields', ORDER_LIST_FIELDS);

    const response = await client.get<AdminOrderListResponse>(
      `${MEDUSA_BASE_URL}/admin/orders?${params.toString()}`
    );
    return response.data;
  },
};
