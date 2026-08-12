'use client';

// src/lib/api/domains/products/shop-listings.client.ts
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  CreateShopListingDto,
  ShopListingDto,
  ShopListingListQuery,
  UpdateShopListingDto,
} from '../../../types/dto/products';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/shop-listings`;

export const shopListingsClient = {
  list: async (query?: ShopListingListQuery): Promise<ShopListingDto[]> => {
    const response = await client.get(BASE, { params: query });
    return response.data;
  },

  get: async (id: string): Promise<ShopListingDto> => {
    const response = await client.get(`${BASE}/${id}`);
    return response.data;
  },

  create: async (dto: CreateShopListingDto): Promise<ShopListingDto> => {
    const response = await client.post(BASE, dto);
    return response.data;
  },

  update: async (id: string, dto: UpdateShopListingDto): Promise<ShopListingDto> => {
    const response = await client.put(`${BASE}/${id}`, dto);
    return response.data;
  },

  remove: async (id: string): Promise<{ message: string }> => {
    const response = await client.delete(`${BASE}/${id}`);
    return response.data;
  },
};
