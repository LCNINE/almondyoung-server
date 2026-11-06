'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type { IdempotentCommand } from '@/lib/services/orders/idempotency';
import type {
  BulkShipmentResult,
  PreparationWaybillResult,
  OutboundPreparationSummary,
} from '@/lib/types/dto/fulfillment';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/outbound-preparation`;

export const outboundPreparationClient = {
  summary: async (warehouseId: string): Promise<OutboundPreparationSummary> => {
    const res = await client.get(BASE, { params: { warehouseId } });

    return res.data;
  },

  planMany: async (
    cmd: IdempotentCommand<{ shipmentIds: string[] }>
  ): Promise<BulkShipmentResult> => {
    const res = await client.post(`${BASE}/plans`, cmd.data, {
      headers: { 'Idempotency-Key': cmd.idempotencyKey },
    });

    return res.data;
  },

  issueWaybills: async (
    cmd: IdempotentCommand<{ shipmentIds: string[] }>
  ): Promise<PreparationWaybillResult[]> => {
    const res = await client.post(`${BASE}/waybills`, cmd.data, {
      headers: { 'Idempotency-Key': cmd.idempotencyKey },
    });

    return res.data;
  },

  addManyToBatch: async (
    batchId: string,
    cmd: IdempotentCommand<{ shipmentIds: string[] }>
  ): Promise<BulkShipmentResult> => {
    const res = await client.post(
      `${BASE}/batches/${encodeURIComponent(batchId)}/shipments`,
      cmd.data,
      { headers: { 'Idempotency-Key': cmd.idempotencyKey } }
    );

    return res.data;
  },

  splitManyUnreserved: async (
    cmd: IdempotentCommand<{ shipmentIds: string[] }>
  ): Promise<BulkShipmentResult> => {
    const res = await client.post(`${BASE}/unreserved-splits`, cmd.data, {
      headers: { 'Idempotency-Key': cmd.idempotencyKey },
    });

    return res.data;
  },
};
