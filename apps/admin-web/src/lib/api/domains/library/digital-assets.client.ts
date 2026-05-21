'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  CreateDigitalAssetDto,
  CreateFileVersionDto,
  DigitalAssetDto,
  DigitalAssetFileVersionDto,
  DigitalAssetListQuery,
  DigitalAssetListResponse,
  UpdateDigitalAssetDto,
} from '@/lib/types/dto/library';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/digital-assets`;

export const digitalAssetsClient = {
  list: async (query?: DigitalAssetListQuery): Promise<DigitalAssetListResponse> => {
    const response = await client.get(BASE, { params: query });
    return response.data;
  },

  get: async (id: string): Promise<DigitalAssetDto> => {
    const response = await client.get(`${BASE}/${id}`);
    return response.data;
  },

  create: async (dto: CreateDigitalAssetDto): Promise<DigitalAssetDto> => {
    const response = await client.post(BASE, dto);
    return response.data;
  },

  update: async (id: string, dto: UpdateDigitalAssetDto): Promise<DigitalAssetDto> => {
    const response = await client.patch(`${BASE}/${id}`, dto);
    return response.data;
  },

  remove: async (id: string): Promise<void> => {
    await client.delete(`${BASE}/${id}`);
  },

  listFileVersions: async (id: string): Promise<DigitalAssetFileVersionDto[]> => {
    const response = await client.get(`${BASE}/${id}/file-versions`);
    return response.data;
  },

  addFileVersion: async (id: string, dto: CreateFileVersionDto): Promise<DigitalAssetFileVersionDto> => {
    const response = await client.post(`${BASE}/${id}/file-versions`, dto);
    return response.data;
  },

  rollbackToFileVersion: async (id: string, versionId: string): Promise<DigitalAssetDto> => {
    const response = await client.post(`${BASE}/${id}/file-versions/${versionId}/rollback`);
    return response.data;
  },
};
