'use client';

import { USER_SERVICE_BASE_URL } from '@/const';
import { RoleDto } from '@/lib/types/dto/user';
import { client } from '../../client';

export const roleApi = {
  listRoles: async (): Promise<RoleDto[]> => {
    const response = await client.get<RoleDto[]>(
      `${USER_SERVICE_BASE_URL}/admin/roles`
    );
    return response.data;
  },
};
