'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  ReservationDto,
  ReservationSummaryDto,
  ReconcileReservationsResponseDto,
  ReservationTargetType,
} from '../../../types/dto/inventory';

export const reservationsClient = {
  getReservationsByTarget: async (
    targetType: ReservationTargetType,
    targetId: string
  ): Promise<ReservationDto[]> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/reservations/by-target?targetType=${encodeURIComponent(targetType)}&targetId=${encodeURIComponent(targetId)}`
    );
    return response.data;
  },

  getReservationsBySku: async (
    skuId: string,
    warehouseId?: string
  ): Promise<ReservationDto[]> => {
    const url = warehouseId
      ? `${ALMONDYOUNG_API_BASE_URL}/inventory/reservations/by-sku/${encodeURIComponent(skuId)}?warehouseId=${encodeURIComponent(warehouseId)}`
      : `${ALMONDYOUNG_API_BASE_URL}/inventory/reservations/by-sku/${encodeURIComponent(skuId)}`;
    const response = await client.get(url);
    return response.data;
  },

  getReservationSummary: async (
    warehouseId: string
  ): Promise<ReservationSummaryDto[]> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/reservations/summary/${encodeURIComponent(warehouseId)}`
    );
    return response.data;
  },

  releaseReservation: async (id: string): Promise<void> => {
    await client.delete(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/reservations/${encodeURIComponent(id)}`
    );
  },

  reconcileReservations: async (): Promise<ReconcileReservationsResponseDto> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/reservations/reconcile`
    );
    return response.data;
  },
};
