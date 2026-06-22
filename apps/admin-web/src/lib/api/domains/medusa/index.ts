'use client';

// Medusa Customer 도메인 API 클라이언트

import { MEDUSA_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  AdminCustomer,
  AdminCustomerAddress,
  AdminCustomerResponse,
  AdminCustomerListResponse,
} from '@medusajs/types';


export type { AdminCustomer, AdminCustomerAddress };

export interface MedusaCustomerAddressPayload {
  address_name: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  company?: string | null;
  address_1: string;
  address_2?: string | null;
  city?: string | null;
  country_code: string;
  province?: string | null;
  postal_code?: string | null;
  is_default_shipping?: boolean;
  is_default_billing?: boolean;
}


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

  getCustomerByAlmondUserId: async (
    almondUserId: string
  ): Promise<AdminCustomerResponse> => {
    const response = await client.get<AdminCustomerResponse>(
      `${MEDUSA_BASE_URL}/admin/customers/by-almond-user/${encodeURIComponent(almondUserId)}`
    );
    return medusaCustomerApi.getCustomerById(response.data.customer.id);
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

  createCustomerAddress: async (
    id: string,
    payload: MedusaCustomerAddressPayload
  ): Promise<AdminCustomerResponse> => {
    const response = await client.post<AdminCustomerResponse>(
      `${MEDUSA_BASE_URL}/admin/customers/${id}/addresses`,
      payload
    );
    return response.data;
  },

  updateCustomerAddress: async (
    id: string,
    addressId: string,
    payload: MedusaCustomerAddressPayload
  ): Promise<AdminCustomerResponse> => {
    const response = await client.post<AdminCustomerResponse>(
      `${MEDUSA_BASE_URL}/admin/customers/${id}/addresses/${addressId}`,
      payload
    );
    return response.data;
  },
};
