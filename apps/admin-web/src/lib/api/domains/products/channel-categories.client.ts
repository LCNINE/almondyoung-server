import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  ChannelCategoryDto,
  ChannelCategoryListResponseDto,
  CreateChannelCategoryDto,
  UpdateChannelCategoryDto,
} from '../../../types/dto/products';

export const listChannelCategories = async (): Promise<ChannelCategoryListResponseDto> => {
  const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/channels/categories`);
  return response.data;
};

export const getChannelCategory = async (id: string): Promise<ChannelCategoryDto> => {
  const response = await client.get(
    `${ALMONDYOUNG_API_BASE_URL}/channels/categories/${encodeURIComponent(id)}`
  );
  return response.data;
};

export const createChannelCategory = async (
  data: CreateChannelCategoryDto
): Promise<ChannelCategoryDto> => {
  const response = await client.post(`${ALMONDYOUNG_API_BASE_URL}/channels/categories`, data);
  return response.data;
};

export const updateChannelCategory = async (
  id: string,
  data: UpdateChannelCategoryDto
): Promise<ChannelCategoryDto> => {
  const response = await client.put(
    `${ALMONDYOUNG_API_BASE_URL}/channels/categories/${encodeURIComponent(id)}`,
    data
  );
  return response.data;
};

export const deleteChannelCategory = async (id: string): Promise<void> => {
  await client.delete(
    `${ALMONDYOUNG_API_BASE_URL}/channels/categories/${encodeURIComponent(id)}`
  );
};

export const channelCategoriesClient = {
  listChannelCategories,
  getChannelCategory,
  createChannelCategory,
  updateChannelCategory,
  deleteChannelCategory,
};
