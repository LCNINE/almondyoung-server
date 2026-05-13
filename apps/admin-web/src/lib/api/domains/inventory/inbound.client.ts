'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  SimpleInboundDto,
  SimpleInboundResponseDto,
  IndividualInboundDto,
  IndividualInboundResponseDto,
  PutawayRequestDto,
  ReturnInboundDto,
  CancelInboundDto,
  UpdateInboundLineMemoDto,
  CreateInboundPlanDto,
  AddInboundPlanItemsDto,
  ReceiveFromPlanDto,
  ReceiveFromPlanResponseDto,
  VerifyBarcodeRequest,
  VerifyBarcodeResponseDto,
  InboundReceiptsQuery,
  InboundReceiptsResponse,
  InboundWorkLogsQuery,
  InboundWorkLogsResponse,
  InboundStatusQuery,
  ListPlanItemsQueryDto,
  InboundPlanItemsResponse,
  InboundPendingListResponseDto,
  InboundActionResponse,
  InboundLineMemoResponse,
} from '../../../types/dto/inventory';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/inbound`;

function buildQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value));
    }
  });
  return params.toString();
}

export const inboundClient = {
  simple: async (data: SimpleInboundDto): Promise<SimpleInboundResponseDto> => {
    const response = await client.post(`${BASE}/simple`, data);
    return response.data;
  },

  simpleFullscan: async (data: SimpleInboundDto): Promise<SimpleInboundResponseDto> => {
    const response = await client.post(`${BASE}/simple-fullscan`, data);
    return response.data;
  },

  individual: async (data: IndividualInboundDto): Promise<IndividualInboundResponseDto> => {
    const response = await client.post(`${BASE}/individual`, data);
    return response.data;
  },

  verifyBarcode: async (data: VerifyBarcodeRequest): Promise<VerifyBarcodeResponseDto> => {
    const response = await client.post(`${BASE}/verify-barcode`, data);
    return response.data;
  },

  pending: async (warehouseId?: string): Promise<InboundPendingListResponseDto> => {
    const qs = warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : '';
    const response = await client.get(`${BASE}/pending${qs}`);
    return response.data;
  },

  receipts: async (query?: InboundReceiptsQuery): Promise<InboundReceiptsResponse> => {
    const qs = buildQueryString((query ?? {}) as Record<string, unknown>);
    const response = await client.get(`${BASE}/receipts${qs ? `?${qs}` : ''}`);
    return response.data;
  },

  workLogs: async (query?: InboundWorkLogsQuery): Promise<InboundWorkLogsResponse> => {
    const qs = buildQueryString((query ?? {}) as Record<string, unknown>);
    const response = await client.get(`${BASE}/work-logs${qs ? `?${qs}` : ''}`);
    return response.data;
  },

  status: async (query?: InboundStatusQuery) => {
    const qs = buildQueryString((query ?? {}) as Record<string, unknown>);
    const response = await client.get(`${BASE}/status${qs ? `?${qs}` : ''}`);
    return response.data;
  },

  putaway: async (data: PutawayRequestDto): Promise<InboundActionResponse> => {
    const response = await client.post(`${BASE}/putaway`, data);
    return response.data;
  },

  return: async (data: ReturnInboundDto): Promise<InboundActionResponse> => {
    const response = await client.post(`${BASE}/return`, data);
    return response.data;
  },

  cancel: async (data: CancelInboundDto): Promise<InboundActionResponse> => {
    const response = await client.post(`${BASE}/cancel`, data);
    return response.data;
  },

  lines: {
    memo: async (
      lineId: string,
      data: UpdateInboundLineMemoDto
    ): Promise<InboundLineMemoResponse> => {
      const response = await client.post(
        `${BASE}/lines/${encodeURIComponent(lineId)}/memo`,
        data
      );
      return response.data;
    },
  },

  plans: {
    create: async (data: CreateInboundPlanDto) => {
      const response = await client.post(`${BASE}/plans`, data);
      return response.data;
    },

    addItems: async (data: AddInboundPlanItemsDto) => {
      const response = await client.post(`${BASE}/plans/items`, data);
      return response.data;
    },

    listItems: async (
      query?: ListPlanItemsQueryDto
    ): Promise<InboundPlanItemsResponse> => {
      const qs = buildQueryString((query ?? {}) as Record<string, unknown>);
      const response = await client.get(`${BASE}/plans/items${qs ? `?${qs}` : ''}`);
      return response.data;
    },

    receive: async (data: ReceiveFromPlanDto): Promise<ReceiveFromPlanResponseDto> => {
      const response = await client.post(`${BASE}/plans/receive`, data);
      return response.data;
    },
  },
};
