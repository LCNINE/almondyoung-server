'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import type {
  BulkUpdateDto,
  BulkDeleteDto,
  BulkRestoreDto,
  BulkOperationResultDto,
  BulkUpdateResultDto,
} from '@/lib/types/dto/products';
import { client } from '../../client';

export const bulkClient = {
  update: async (dto: BulkUpdateDto): Promise<BulkUpdateResultDto> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/masters/bulk/update`,
      dto
    );
    return response.data;
  },

  delete: async (dto: BulkDeleteDto): Promise<BulkOperationResultDto> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/masters/bulk/delete`,
      dto
    );
    return response.data;
  },

  restore: async (dto: BulkRestoreDto): Promise<BulkOperationResultDto> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/masters/bulk/restore`,
      dto
    );
    return response.data;
  },
};
