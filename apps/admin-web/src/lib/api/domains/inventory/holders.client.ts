import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  HolderDto,
  HolderFiltersDto,
  HolderListResponseDto,
  CreateHolderRequest,
  UpdateHolderRequest,
} from '../../../types/dto/inventory';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/holders`;

function buildQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value));
    }
  });
  return params.toString();
}

export const listHolders = async (filters?: HolderFiltersDto): Promise<HolderListResponseDto> => {
  const response = await client.get(`${BASE}?${buildQueryString((filters ?? {}) as Record<string, unknown>)}`);
  return response.data;
};

export const getHolder = async (id: string): Promise<HolderDto> => {
  const response = await client.get(`${BASE}/${encodeURIComponent(id)}`);
  return response.data;
};

export const createHolder = async (data: CreateHolderRequest): Promise<HolderDto> => {
  const response = await client.post(BASE, data);
  return response.data;
};

export const updateHolder = async (id: string, data: UpdateHolderRequest): Promise<HolderDto> => {
  const response = await client.put(`${BASE}/${encodeURIComponent(id)}`, data);
  return response.data;
};

export const deleteHolder = async (id: string): Promise<{ success: boolean }> => {
  const response = await client.delete(`${BASE}/${encodeURIComponent(id)}`);
  return response.data;
};

export const holdersClient = {
  list: listHolders,
  get: getHolder,
  create: createHolder,
  update: updateHolder,
  delete: deleteHolder,
};
