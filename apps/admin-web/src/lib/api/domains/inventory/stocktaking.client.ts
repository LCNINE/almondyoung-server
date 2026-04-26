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

export const createStocktakingSession = async (
  data: CreateStocktakingSessionRequest
): Promise<StocktakingSessionDto> => {
  const response = await client.post(`${BASE}/sessions`, data);
  return response.data;
};

export const startStocktakingSession = async (
  id: string
): Promise<StartStocktakingSessionResponse> => {
  const response = await client.post(`${BASE}/sessions/${encodeURIComponent(id)}/start`);
  return response.data;
};

export const scanLocation = async (data: ScanLocationRequest): Promise<ScanLocationResponse> => {
  const response = await client.post(`${BASE}/scan-location`, data);
  return response.data;
};

export const scanProduct = async (data: ScanProductRequest): Promise<ScanProductResponse> => {
  const response = await client.post(`${BASE}/scan-product`, data);
  return response.data;
};

export const updateLineCount = async (
  lineId: string,
  data: UpdateLineCountRequest
): Promise<UpdateLineCountResponse> => {
  const response = await client.put(
    `${BASE}/lines/${encodeURIComponent(lineId)}/count`,
    data
  );
  return response.data;
};

export const getStocktakingVariances = async (
  sessionId: string
): Promise<StocktakingVarianceDto[]> => {
  const response = await client.get(
    `${BASE}/sessions/${encodeURIComponent(sessionId)}/variances`
  );
  return response.data;
};

export const generateAdjustments = async (
  sessionId: string,
  data: GenerateAdjustmentsRequest = {}
): Promise<GenerateAdjustmentsResponse> => {
  const response = await client.post(
    `${BASE}/sessions/${encodeURIComponent(sessionId)}/generate-adjustments`,
    data
  );
  return response.data;
};

export const completeStocktakingSession = async (
  sessionId: string
): Promise<CompleteStocktakingSessionResponse> => {
  const response = await client.post(
    `${BASE}/sessions/${encodeURIComponent(sessionId)}/complete`
  );
  return response.data;
};

export const stocktakingClient = {
  createSession: createStocktakingSession,
  startSession: startStocktakingSession,
  scanLocation,
  scanProduct,
  updateLineCount,
  getVariances: getStocktakingVariances,
  generateAdjustments,
  completeSession: completeStocktakingSession,
};
