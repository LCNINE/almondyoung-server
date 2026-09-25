'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  CreateDeliveryProfileDto,
  DeliveryProfileDto,
  UpdateDeliveryProfileDto,
} from '../../../types/dto/inventory';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/inventory/delivery-profiles`;

export const deliveryProfilesClient = {
  list: async (): Promise<DeliveryProfileDto[]> => (await client.get(BASE)).data,
  create: async (data: CreateDeliveryProfileDto): Promise<DeliveryProfileDto> => (await client.post(BASE, data)).data,
  update: async (id: string, data: UpdateDeliveryProfileDto): Promise<DeliveryProfileDto> =>
    (await client.patch(`${BASE}/${encodeURIComponent(id)}`, data)).data,
};
