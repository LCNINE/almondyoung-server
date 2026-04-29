import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  MoveBatchRequestDto,
  MovementJobWithLinesDto,
  MovementHistoryResponseDto,
  MovementHistoryQuery,
} from '../../../types/dto/inventory';

function buildQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value));
    }
  });
  return params.toString();
}

export const moveImmediately = async (data: MoveBatchRequestDto): Promise<MovementJobWithLinesDto> => {
  const response = await client.post(`${ALMONDYOUNG_API_BASE_URL}/movement/move`, data);
  return response.data;
};

export const getMovementJob = async (jobId: string): Promise<MovementJobWithLinesDto> => {
  const response = await client.get(
    `${ALMONDYOUNG_API_BASE_URL}/movement/jobs/${encodeURIComponent(jobId)}`
  );
  return response.data;
};

export const getMovementHistory = async (
  query: MovementHistoryQuery = {}
): Promise<MovementHistoryResponseDto> => {
  const response = await client.get(
    `${ALMONDYOUNG_API_BASE_URL}/movement/history?${buildQueryString(query as Record<string, unknown>)}`
  );
  return response.data;
};

export const movementClient = {
  moveImmediately,
  getMovementJob,
  getMovementHistory,
};
