'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  AdminOwnershipDto,
  AdminOwnershipListQuery,
  AdminOwnershipListResponse,
  GrantOwnershipDto,
  RevokeOwnershipDto,
} from '@/lib/types/dto/library';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/library/admin/ownerships`;

export const ownershipsClient = {
  list: async (query?: AdminOwnershipListQuery): Promise<AdminOwnershipListResponse> => {
    const response = await client.get(BASE, { params: query });
    return response.data;
  },

  grant: async (dto: GrantOwnershipDto): Promise<AdminOwnershipDto> => {
    const response = await client.post(`${BASE}/grant`, dto);
    return response.data;
  },

  revoke: async (id: string, dto?: RevokeOwnershipDto): Promise<AdminOwnershipDto> => {
    const response = await client.post(`${BASE}/${id}/revoke`, dto ?? {});
    return response.data;
  },

  reactivate: async (id: string): Promise<AdminOwnershipDto> => {
    const response = await client.post(`${BASE}/${id}/resend`);
    return response.data;
  },
};
