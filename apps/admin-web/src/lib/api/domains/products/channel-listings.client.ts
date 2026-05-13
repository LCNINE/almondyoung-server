import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  ChannelListingDto,
  ChannelListingListResponseDto,
  CreateChannelListingDto,
  UpdateChannelListingDto,
} from '../../../types/dto/products';

export const channelListingsClient = {
  createChannelListing: async (
    data: CreateChannelListingDto
  ): Promise<ChannelListingDto> => {
    const response = await client.post(`${ALMONDYOUNG_API_BASE_URL}/channel-listings`, data);
    return response.data;
  },

  getChannelListingsByVariant: async (
    variantId: string
  ): Promise<ChannelListingListResponseDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/channel-listings/by-variant/${encodeURIComponent(variantId)}`
    );
    return response.data;
  },

  getChannelListing: async (id: string): Promise<ChannelListingDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/channel-listings/${encodeURIComponent(id)}`
    );
    return response.data;
  },

  updateChannelListing: async (
    id: string,
    data: UpdateChannelListingDto
  ): Promise<ChannelListingDto> => {
    const response = await client.put(
      `${ALMONDYOUNG_API_BASE_URL}/channel-listings/${encodeURIComponent(id)}`,
      data
    );
    return response.data;
  },

  activateChannelListing: async (id: string): Promise<void> => {
    await client.put(
      `${ALMONDYOUNG_API_BASE_URL}/channel-listings/${encodeURIComponent(id)}/activate`
    );
  },

  deactivateChannelListing: async (id: string): Promise<void> => {
    await client.put(
      `${ALMONDYOUNG_API_BASE_URL}/channel-listings/${encodeURIComponent(id)}/deactivate`
    );
  },

  deleteChannelListing: async (id: string): Promise<void> => {
    await client.delete(
      `${ALMONDYOUNG_API_BASE_URL}/channel-listings/${encodeURIComponent(id)}`
    );
  },
};
