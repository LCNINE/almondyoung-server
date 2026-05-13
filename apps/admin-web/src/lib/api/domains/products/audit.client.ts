'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import type {
  AuditLogItemDto,
  ProductAuditHistoryItemDto,
} from '@/lib/types/dto/products';
import { client } from '../../client';

export const auditClient = {
  getProductHistory: async (
    masterId: string
  ): Promise<ProductAuditHistoryItemDto[]> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/products/audit/${masterId}`
    );
    return response.data;
  },

  getRecent: async (limit = 100): Promise<AuditLogItemDto[]> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/products/audit/recent?limit=${limit}`
    );
    return response.data;
  },

  getByUser: async (
    userId: string,
    limit = 100
  ): Promise<AuditLogItemDto[]> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/products/audit/by-user/${userId}?limit=${limit}`
    );
    return response.data;
  },

  getByAction: async (
    action: string,
    limit = 100
  ): Promise<AuditLogItemDto[]> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/products/audit/by-action/${action}?limit=${limit}`
    );
    return response.data;
  },
};
