import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  ReservationDto,
  ReservationSummaryDto,
  ExpireStaleReservationsResponseDto,
  ReservationTargetType,
} from '../../../types/dto/inventory';

export const getReservationsByTarget = async (
  targetType: ReservationTargetType,
  targetId: string
): Promise<ReservationDto[]> => {
  const response = await client.get(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/reservations/by-target?targetType=${encodeURIComponent(targetType)}&targetId=${encodeURIComponent(targetId)}`
  );
  return response.data;
};

export const getReservationsBySku = async (
  skuId: string,
  warehouseId?: string
): Promise<ReservationDto[]> => {
  const url = warehouseId
    ? `${ALMONDYOUNG_API_BASE_URL}/inventory/reservations/by-sku/${encodeURIComponent(skuId)}?warehouseId=${encodeURIComponent(warehouseId)}`
    : `${ALMONDYOUNG_API_BASE_URL}/inventory/reservations/by-sku/${encodeURIComponent(skuId)}`;
  const response = await client.get(url);
  return response.data;
};

export const getReservationSummary = async (
  warehouseId: string
): Promise<ReservationSummaryDto[]> => {
  const response = await client.get(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/reservations/summary/${encodeURIComponent(warehouseId)}`
  );
  return response.data;
};

export const releaseReservation = async (id: string): Promise<void> => {
  await client.delete(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/reservations/${encodeURIComponent(id)}`
  );
};

export const expireStaleReservations = async (): Promise<ExpireStaleReservationsResponseDto> => {
  const response = await client.post(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/reservations/expire-stale`
  );
  return response.data;
};

export const reservationsClient = {
  getReservationsByTarget,
  getReservationsBySku,
  getReservationSummary,
  releaseReservation,
  expireStaleReservations,
};
