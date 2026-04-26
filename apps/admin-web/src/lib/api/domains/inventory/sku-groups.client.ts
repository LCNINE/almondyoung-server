import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  SkuGroupResponseDto,
  SkuGroupMembersResponseDto,
  CreateSkuGroupDto,
  UpdateSkuGroupDto,
  AddSkuToGroupDto,
  BulkAddSkusToGroupDto,
  BulkAddSkusResponseDto,
  SkuResponseDto,
} from '../../../types/dto/inventory';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/inventory/sku-groups`;

export const getSkuGroups = async (): Promise<SkuGroupResponseDto[]> => {
  const response = await client.get(BASE);
  return response.data;
};

export const getSkuGroup = async (id: string): Promise<SkuGroupResponseDto> => {
  const response = await client.get(`${BASE}/${encodeURIComponent(id)}`);
  return response.data;
};

export const createSkuGroup = async (data: CreateSkuGroupDto): Promise<SkuGroupResponseDto> => {
  const response = await client.post(BASE, data);
  return response.data;
};

export const updateSkuGroup = async (
  id: string,
  data: UpdateSkuGroupDto
): Promise<SkuGroupResponseDto> => {
  const response = await client.put(`${BASE}/${encodeURIComponent(id)}`, data);
  return response.data;
};

export const deleteSkuGroup = async (id: string): Promise<void> => {
  await client.delete(`${BASE}/${encodeURIComponent(id)}`);
};

export const getSkuGroupMembers = async (id: string): Promise<SkuGroupMembersResponseDto> => {
  const response = await client.get(`${BASE}/${encodeURIComponent(id)}/members`);
  return response.data;
};

export const addSkuToGroup = async (
  groupId: string,
  data: AddSkuToGroupDto
): Promise<void> => {
  await client.post(`${BASE}/${encodeURIComponent(groupId)}/members`, data);
};

export const bulkAddSkusToGroup = async (
  groupId: string,
  data: BulkAddSkusToGroupDto
): Promise<BulkAddSkusResponseDto> => {
  const response = await client.post(
    `${BASE}/${encodeURIComponent(groupId)}/members/bulk`,
    data
  );
  return response.data;
};

export const removeSkuFromGroup = async (skuId: string): Promise<void> => {
  await client.delete(`${BASE}/members/${encodeURIComponent(skuId)}`);
};

export const getUngroupedSkus = async (params?: {
  limit?: number;
  offset?: number;
}): Promise<{ items: SkuResponseDto[]; total: number }> => {
  const qs = params
    ? '?' + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
    : '';
  const response = await client.get(`${BASE}/ungrouped${qs}`);
  return response.data;
};

export const skuGroupsClient = {
  getSkuGroups,
  getSkuGroup,
  createSkuGroup,
  updateSkuGroup,
  deleteSkuGroup,
  getSkuGroupMembers,
  addSkuToGroup,
  bulkAddSkusToGroup,
  removeSkuFromGroup,
  getUngroupedSkus,
};
