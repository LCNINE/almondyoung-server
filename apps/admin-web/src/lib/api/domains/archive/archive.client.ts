'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  ArchivePageDetailDto,
  ArchivePageNodeDto,
  ArchivePageSaveResultDto,
  ArchivePageVersionDetailDto,
  ArchivePageVersionDto,
  ArchiveSearchResultDto,
  ArchiveSpace,
  ArchiveTrashItemDto,
  CreateArchivePageDto,
  MoveArchivePageDto,
  UpdateArchivePageDto,
} from '@/lib/types/dto/archive';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/archive`;

export const archiveClient = {
  listTree: async (space: ArchiveSpace): Promise<ArchivePageNodeDto[]> => {
    const response = await client.get(`${BASE}/pages`, { params: { space } });
    return response.data;
  },

  get: async (id: string): Promise<ArchivePageDetailDto> => {
    const response = await client.get(`${BASE}/pages/${id}`);
    return response.data;
  },

  create: async (dto: CreateArchivePageDto): Promise<ArchivePageDetailDto> => {
    const response = await client.post(`${BASE}/pages`, dto);
    return response.data;
  },

  update: async (
    id: string,
    dto: UpdateArchivePageDto
  ): Promise<ArchivePageSaveResultDto> => {
    const response = await client.patch(`${BASE}/pages/${id}`, dto);
    return response.data;
  },

  move: async (
    id: string,
    dto: MoveArchivePageDto
  ): Promise<ArchivePageNodeDto[]> => {
    const response = await client.post(`${BASE}/pages/${id}/move`, dto);
    return response.data;
  },

  remove: async (id: string): Promise<{ removedIds: string[] }> => {
    const response = await client.delete(`${BASE}/pages/${id}`);
    return response.data;
  },

  restore: async (id: string): Promise<ArchivePageDetailDto> => {
    const response = await client.post(`${BASE}/pages/${id}/restore`);
    return response.data;
  },

  purge: async (id: string): Promise<{ purgedIds: string[] }> => {
    const response = await client.delete(`${BASE}/pages/${id}/purge`);
    return response.data;
  },

  setFavorite: async (
    id: string,
    favorite: boolean
  ): Promise<{ isFavorite: boolean }> => {
    const response = favorite
      ? await client.post(`${BASE}/pages/${id}/favorite`)
      : await client.delete(`${BASE}/pages/${id}/favorite`);
    return response.data;
  },

  search: async (query: string): Promise<ArchiveSearchResultDto> => {
    const response = await client.get(`${BASE}/search`, {
      params: { q: query },
    });
    return response.data;
  },

  listFavorites: async (): Promise<ArchivePageNodeDto[]> => {
    const response = await client.get(`${BASE}/favorites`);
    return response.data;
  },

  listRecent: async (): Promise<ArchivePageNodeDto[]> => {
    const response = await client.get(`${BASE}/recent`);
    return response.data;
  },

  listTrash: async (): Promise<ArchiveTrashItemDto[]> => {
    const response = await client.get(`${BASE}/trash`);
    return response.data;
  },

  listVersions: async (id: string): Promise<ArchivePageVersionDto[]> => {
    const response = await client.get(`${BASE}/pages/${id}/versions`);
    return response.data;
  },

  getVersion: async (
    id: string,
    versionId: string
  ): Promise<ArchivePageVersionDetailDto> => {
    const response = await client.get(
      `${BASE}/pages/${id}/versions/${versionId}`
    );
    return response.data;
  },

  restoreVersion: async (
    id: string,
    versionId: string
  ): Promise<ArchivePageDetailDto> => {
    const response = await client.post(
      `${BASE}/pages/${id}/versions/${versionId}/restore`
    );
    return response.data;
  },
};
