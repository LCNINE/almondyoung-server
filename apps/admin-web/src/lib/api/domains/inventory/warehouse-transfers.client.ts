'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type { CreateTransferOrderRequest, CreateTransferOrderResponseDto } from '../../../types/dto/inventory';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/inventory/warehouse-transfers`;

export const warehouseTransfersClient = {
  create: async (data: CreateTransferOrderRequest): Promise<CreateTransferOrderResponseDto> => {
    const response = await client.post(BASE, data);
    return response.data;
  },
};
