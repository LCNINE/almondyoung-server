'use client';

// src/lib/api/domains/orders/picking.client.ts
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  CreatePickingPlanRequest,
  StartPickingV2Request,
  DiscretePickingScanRequest,
  PickingHandoffRequest,
  CompletePickingRequest,
  PickingPlanResult,
  PickingStartResult,
  PickingScanResult,
  PickingHandoffResult,
  InspectionReadyOutput,
  AggregateBulkCartScanRequest,
  AggregateSortScanRequest,
  AggregateCartHandoffRequest,
  AggregateSourceScanResult,
  AggregateSortScanResult,
  AggregateCartHandoffResult,
  RegisterToteRequest,
  AssignToteRequest,
  ToteScanRequest,
  ToteHandoffRequest,
  ReleaseToteRequest,
  ToteRegistrationResult,
  ToteAssignmentResult,
  ToteScanResult,
  ToteHandoffResult,
  ToteReleaseResult,
} from '@/lib/types/dto/fulfillment';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/picking`;

export const pickingClient = {
  createPlan: async (
    data: CreatePickingPlanRequest,
    idempotencyKey: string
  ): Promise<PickingPlanResult> => {
    const res = await client.post(`${BASE}/v2/plans`, data, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return res.data;
  },

  startV2: async (
    data: StartPickingV2Request,
    idempotencyKey: string
  ): Promise<PickingStartResult> => {
    const res = await client.post(`${BASE}/v2/starts`, data, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return res.data;
  },

  scanV2: async (
    data: DiscretePickingScanRequest,
    idempotencyKey: string
  ): Promise<PickingScanResult> => {
    const res = await client.post(`${BASE}/v2/scans`, data, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return res.data;
  },

  handoffV2: async (
    data: PickingHandoffRequest,
    idempotencyKey: string
  ): Promise<PickingHandoffResult> => {
    const res = await client.post(`${BASE}/v2/handoffs`, data, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return res.data;
  },

  completeV2: async (
    data: CompletePickingRequest,
    idempotencyKey: string
  ): Promise<InspectionReadyOutput> => {
    const res = await client.post(`${BASE}/v2/completions`, data, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return res.data;
  },

  aggregateBulkCartScan: async (
    data: AggregateBulkCartScanRequest,
    idempotencyKey: string
  ): Promise<AggregateSourceScanResult> => {
    const res = await client.post(
      `${BASE}/v2/aggregate-then-sort/bulk-cart-scans`,
      data,
      {
        headers: { 'Idempotency-Key': idempotencyKey },
      }
    );
    return res.data;
  },

  aggregateSortScan: async (
    data: AggregateSortScanRequest,
    idempotencyKey: string
  ): Promise<AggregateSortScanResult> => {
    const res = await client.post(
      `${BASE}/v2/aggregate-then-sort/sort-scans`,
      data,
      {
        headers: { 'Idempotency-Key': idempotencyKey },
      }
    );
    return res.data;
  },

  aggregateCartHandoff: async (
    data: AggregateCartHandoffRequest,
    idempotencyKey: string
  ): Promise<AggregateCartHandoffResult> => {
    const res = await client.post(
      `${BASE}/v2/aggregate-then-sort/cart-handoffs`,
      data,
      {
        headers: { 'Idempotency-Key': idempotencyKey },
      }
    );
    return res.data;
  },

  registerTote: async (
    data: RegisterToteRequest,
    idempotencyKey: string
  ): Promise<ToteRegistrationResult> => {
    const res = await client.post(`${BASE}/v2/totes/registrations`, data, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return res.data;
  },

  assignTote: async (
    data: AssignToteRequest,
    idempotencyKey: string
  ): Promise<ToteAssignmentResult> => {
    const res = await client.post(`${BASE}/v2/totes/assignments`, data, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return res.data;
  },

  scanTote: async (
    data: ToteScanRequest,
    idempotencyKey: string
  ): Promise<ToteScanResult> => {
    const res = await client.post(`${BASE}/v2/totes/scans`, data, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return res.data;
  },

  handoffTote: async (
    data: ToteHandoffRequest,
    idempotencyKey: string
  ): Promise<ToteHandoffResult> => {
    const res = await client.post(`${BASE}/v2/totes/handoffs`, data, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return res.data;
  },

  releaseTote: async (
    data: ReleaseToteRequest,
    idempotencyKey: string
  ): Promise<ToteReleaseResult> => {
    const res = await client.post(`${BASE}/v2/totes/releases`, data, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return res.data;
  },
};
