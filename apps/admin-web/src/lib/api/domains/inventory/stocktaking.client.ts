'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import { performStocktakingOperation } from './stocktaking-operation';
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
  CompleteStocktakingSessionRequest,
  ResetStocktakingCountRequest,
  ResetStocktakingCountResponse,
} from '../../../types/dto/inventory';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/stocktaking`;

export const stocktakingClient = {
  createSession: async (
    data: CreateStocktakingSessionRequest
  ): Promise<StocktakingSessionDto> => {
    const response = await client.post(`${BASE}/sessions`, data);
    return response.data;
  },

  startSession: async (
    id: string
  ): Promise<StartStocktakingSessionResponse> => {
    const response = await client.post(
      `${BASE}/sessions/${encodeURIComponent(id)}/start`
    );
    return response.data;
  },

  scanLocation: async (
    data: ScanLocationRequest
  ): Promise<ScanLocationResponse> => {
    return performStocktakingOperation('post', `${BASE}/scan-location`, {
      ...data,
      contractVersion: 2,
    });
  },

  scanProduct: async (
    data: ScanProductRequest
  ): Promise<ScanProductResponse> => {
    return performStocktakingOperation('post', `${BASE}/scan-product`, {
      ...data,
      contractVersion: 2,
    });
  },

  updateLineCount: async (
    lineId: string,
    data: UpdateLineCountRequest
  ): Promise<UpdateLineCountResponse> => {
    return performStocktakingOperation(
      'put',
      `${BASE}/lines/${encodeURIComponent(lineId)}/count`,
      { ...data, contractVersion: 2 }
    );
  },

  resetCount: async (
    lineId: string,
    data: ResetStocktakingCountRequest
  ): Promise<ResetStocktakingCountResponse> => {
    return performStocktakingOperation(
      'post',
      `${BASE}/lines/${encodeURIComponent(lineId)}/reset-count`,
      { ...data, contractVersion: 2 }
    );
  },

  getVariances: async (
    sessionId: string
  ): Promise<StocktakingVarianceDto[]> => {
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
      { ...data, contractVersion: 2 }
    );
    return response.data;
  },

  completeSession: async (
    sessionId: string,
    data: CompleteStocktakingSessionRequest
  ): Promise<CompleteStocktakingSessionResponse> => {
    return performStocktakingOperation(
      'post',
      `${BASE}/sessions/${encodeURIComponent(sessionId)}/complete`,
      { ...data, contractVersion: 2 }
    );
  },
};
