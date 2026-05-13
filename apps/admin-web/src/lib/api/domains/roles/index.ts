'use client';

import { USER_SERVICE_BASE_URL } from '@/const';
import { CreateRoleDto, RoleDto, UpdateRoleDto } from '@/lib/types/dto/user';
import { client } from '../../client';

export const roleApi = {
  listRoles: async (): Promise<RoleDto[]> => {
    const response = await client.get<RoleDto[]>(
      `${USER_SERVICE_BASE_URL}/admin/roles`
    );
    return response.data;
  },

  createRole: async (dto: CreateRoleDto): Promise<RoleDto> => {
    const response = await client.post<RoleDto>(
      `${USER_SERVICE_BASE_URL}/admin/roles`,
      dto
    );
    return response.data;
  },

  updateRole: async (roleId: string, dto: UpdateRoleDto): Promise<RoleDto> => {
    const response = await client.patch<RoleDto>(
      `${USER_SERVICE_BASE_URL}/admin/roles/${roleId}`,
      dto
    );
    return response.data;
  },

  deleteRole: async (roleId: string): Promise<void> => {
    await client.delete(`${USER_SERVICE_BASE_URL}/admin/roles/${roleId}`);
  },
};
