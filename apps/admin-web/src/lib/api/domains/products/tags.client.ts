// src/lib/api/domains/products/tags.client.ts
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  CreateTagGroupDto,
  CreateTagValueDto,
  TagGroupDto,
  TagGroupListQuery,
  TagValueDto,
  UpdateTagGroupDto,
  UpdateTagValueDto,
} from '../../../types/dto/products';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/tags`;

export const tagsClient = {
  // 태그 그룹
  listGroups: async (query?: TagGroupListQuery): Promise<TagGroupDto[]> => {
    const response = await client.get(`${BASE}/groups`, { params: query });
    return response.data;
  },

  getGroup: async (id: string): Promise<TagGroupDto> => {
    const response = await client.get(`${BASE}/groups/${id}`);
    return response.data;
  },

  createGroup: async (dto: CreateTagGroupDto): Promise<TagGroupDto> => {
    const response = await client.post(`${BASE}/groups`, dto);
    return response.data;
  },

  updateGroup: async (id: string, dto: UpdateTagGroupDto): Promise<TagGroupDto> => {
    const response = await client.put(`${BASE}/groups/${id}`, dto);
    return response.data;
  },

  removeGroup: async (id: string): Promise<void> => {
    await client.delete(`${BASE}/groups/${id}`);
  },

  // 태그 값
  getValue: async (id: string): Promise<TagValueDto> => {
    const response = await client.get(`${BASE}/values/${id}`);
    return response.data;
  },

  createValue: async (groupId: string, dto: CreateTagValueDto): Promise<TagValueDto> => {
    const response = await client.post(`${BASE}/groups/${groupId}/values`, dto);
    return response.data;
  },

  updateValue: async (id: string, dto: UpdateTagValueDto): Promise<TagValueDto> => {
    const response = await client.put(`${BASE}/values/${id}`, dto);
    return response.data;
  },

  removeValue: async (id: string): Promise<void> => {
    await client.delete(`${BASE}/values/${id}`);
  },
};
