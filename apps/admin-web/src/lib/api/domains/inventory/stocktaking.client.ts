'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  StocktakingSessionDto,
  StocktakingVarianceDto,
  CreateStocktakingSessionRequest,
  StartStocktakingSessionResponse,
  ScanLocationRequest,
  ScanLocationResponse,
  ScanProductRequest,
  ScanProductResponse,
  UpdateLineCountRequest,
  UpdateLineCountResponse,
  GenerateAdjustmentsRequest,
  GenerateAdjustmentsResponse,
  CompleteStocktakingSessionResponse,
} from '../../../types/dto/inventory';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/stocktaking`;

export const stocktakingClient = {
  createSession: async (
    data: CreateStocktakingSessionRequest
  ): Promise<StocktakingSessionDto> => {
    const response = await client.post(`${BASE}/sessions`, data);
    return response.data;
  },

  startSession: async (id: string): Promise<StartStocktakingSessionResponse> => {
    const response = await client.post(`${BASE}/sessions/${encodeURIComponent(id)}/start`);
    return response.data;
  },

  scanLocation: async (data: ScanLocationRequest): Promise<ScanLocationResponse> => {
    const response = await client.post(`${BASE}/scan-location`, data);
    return response.data;
  },

  scanProduct: async (data: ScanProductRequest): Promise<ScanProductResponse> => {
    const response = await client.post(`${BASE}/scan-product`, data);
    return response.data;
  },

  updateLineCount: async (
    lineId: string,
    data: UpdateLineCountRequest
  ): Promise<UpdateLineCountResponse> => {
    const response = await client.put(
      `${BASE}/lines/${encodeURIComponent(lineId)}/count`,
      data
    );
    return response.data;
  },

  getVariances: async (sessionId: string): Promise<StocktakingVarianceDto[]> => {
    const response = await client.get(
      `${BASE}/sessions/${encodeURIComponent(sessionId)}/variances`
    );
    return response.data;
  },

  generateAdjustments: async (
    sessionId: string,
    data: GenerateAdjustmentsRequest = {}
  ): Promise<GenerateAdjustmentsResponse> => {
    const response = await client.post(
      `${BASE}/sessions/${encodeURIComponent(sessionId)}/generate-adjustments`,
      data
    );
    return response.data;
  },

  completeSession: async (
    sessionId: string
  ): Promise<CompleteStocktakingSessionResponse> => {
    const response = await client.post(
      `${BASE}/sessions/${encodeURIComponent(sessionId)}/complete`
    );
    return response.data;
  },
};
