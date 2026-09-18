'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import type {
  AuditLogPageDto,
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

  list: async (params: {
    page: number;
    limit: number;
    action?: string;
  }): Promise<AuditLogPageDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/products/audit`,
      { params }
    );
    return response.data;
  },
};
