'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  LocationDto,
  LocationColumnDto,
  LocationRackDto,
  LocationListResponseDto,
  LocationCreateResultDto,
  LocationFiltersDto,
  CreateColumnRequest,
  UpdateColumnRequest,
  CreateRackRequest,
  UpdateRackRequest,
  CreateZoneLocationRequest,
  UpdateLocationRequest,
  AddCustomBinRequest,
} from '../../../types/dto/inventory';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/locations`;

function buildQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value));
    }
  });
  return params.toString();
}

export const locationsClient = {
  list: async (
    warehouseId: string,
    filters?: LocationFiltersDto
  ): Promise<LocationListResponseDto> => {
    const response = await client.get(
      `${BASE}/warehouses/${encodeURIComponent(warehouseId)}?${buildQueryString((filters ?? {}) as Record<string, unknown>)}`
    );
    return response.data;
  },

  get: async (id: string): Promise<LocationDto> => {
    const response = await client.get(`${BASE}/${encodeURIComponent(id)}`);
    return response.data;
  },

  update: async (id: string, data: UpdateLocationRequest): Promise<LocationDto> => {
    const response = await client.put(`${BASE}/${encodeURIComponent(id)}`, data);
    return response.data;
  },

  columns: {
    list: async (
      warehouseId: string,
      isActive?: boolean
    ): Promise<LocationColumnDto[]> => {
      const qs = isActive !== undefined ? `?isActive=${isActive}` : '';
      const response = await client.get(
        `${BASE}/warehouses/${encodeURIComponent(warehouseId)}/columns${qs}`
      );
      return response.data;
    },

    create: async (
      warehouseId: string,
      data: CreateColumnRequest
    ): Promise<LocationColumnDto> => {
      const response = await client.post(
        `${BASE}/warehouses/${encodeURIComponent(warehouseId)}/columns`,
        data
      );
      return response.data;
    },

    update: async (
      columnId: string,
      data: UpdateColumnRequest
    ): Promise<LocationColumnDto> => {
      const response = await client.put(
        `${BASE}/columns/${encodeURIComponent(columnId)}`,
        data
      );
      return response.data;
    },
  },

  racks: {
    list: async (
      warehouseId: string,
      query?: { columnName?: string; isActive?: boolean }
    ): Promise<LocationRackDto[]> => {
      const qs = buildQueryString((query ?? {}) as Record<string, unknown>);
      const response = await client.get(
        `${BASE}/warehouses/${encodeURIComponent(warehouseId)}/racks?${qs}`
      );
      return response.data;
    },

    create: async (
      warehouseId: string,
      data: CreateRackRequest
    ): Promise<LocationCreateResultDto> => {
      const response = await client.post(
        `${BASE}/warehouses/${encodeURIComponent(warehouseId)}/racks`,
        data
      );
      return response.data;
    },

    update: async (
      rackId: string,
      data: UpdateRackRequest
    ): Promise<LocationRackDto> => {
      const response = await client.put(
        `${BASE}/racks/${encodeURIComponent(rackId)}`,
        data
      );
      return response.data;
    },
  },

  zones: {
    create: async (
      warehouseId: string,
      data: CreateZoneLocationRequest
    ): Promise<LocationDto> => {
      const response = await client.post(
        `${BASE}/warehouses/${encodeURIComponent(warehouseId)}/zones`,
        data
      );
      return response.data;
    },
  },

  customBins: {
    add: async (
      warehouseId: string,
      data: AddCustomBinRequest
    ): Promise<LocationDto> => {
      const response = await client.post(
        `${BASE}/warehouses/${encodeURIComponent(warehouseId)}/racks/custom-bins`,
        data
      );
      return response.data;
    },
  },
};
