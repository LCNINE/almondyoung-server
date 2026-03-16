import { USER_SERVICE_BASE_URL } from '@/const';
import { CreateRoleDto, RoleDto, UpdateRoleDto } from '@/lib/types/dto/user';
import { ApiResponse } from '@/lib/types/dto/api';
import { AxiosResponse } from 'axios';
import { client } from '../../client';

export const roleApi = {
  listRoles: async (): Promise<RoleDto[]> => {
    const response: AxiosResponse<ApiResponse<RoleDto[]>> = await client.get(
      `${USER_SERVICE_BASE_URL}/admin/roles`
    );
    return response.data.data;
  },

  createRole: async (dto: CreateRoleDto): Promise<RoleDto> => {
    const response: AxiosResponse<ApiResponse<RoleDto>> = await client.post(
      `${USER_SERVICE_BASE_URL}/admin/roles`,
      dto
    );
    return response.data.data;
  },

  updateRole: async (roleId: string, dto: UpdateRoleDto): Promise<RoleDto> => {
    const response: AxiosResponse<ApiResponse<RoleDto>> = await client.patch(
      `${USER_SERVICE_BASE_URL}/admin/roles/${roleId}`,
      dto
    );
    return response.data.data;
  },

  deleteRole: async (roleId: string): Promise<void> => {
    await client.delete(`${USER_SERVICE_BASE_URL}/admin/roles/${roleId}`);
  },
};
