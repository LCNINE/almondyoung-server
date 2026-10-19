'use client';

import { USER_SERVICE_BASE_URL } from '@/const';
import type {
  CreateRoleInput,
  RoleDetail,
  RoleMember,
  RoleSummary,
  UpdateRoleInput,
} from '@/lib/types/dto/iam';
import { client } from '../../client';

const base = () => `${USER_SERVICE_BASE_URL}/admin/roles`;

export const roleApi = {
  listRoles: async (): Promise<RoleSummary[]> =>
    (await client.get<RoleSummary[]>(base())).data,
  getRole: async (roleId: string): Promise<RoleDetail> =>
    (await client.get<RoleDetail>(`${base()}/${roleId}`)).data,
  createRole: async (input: CreateRoleInput): Promise<RoleDetail> =>
    (await client.post<RoleDetail>(base(), input)).data,
  updateRole: async (
    roleId: string,
    input: UpdateRoleInput
  ): Promise<RoleDetail> =>
    (await client.patch<RoleDetail>(`${base()}/${roleId}`, input)).data,
  replacePermissions: async (
    roleId: string,
    permissions: string[],
    version: number
  ): Promise<RoleDetail> =>
    (
      await client.put<RoleDetail>(`${base()}/${roleId}/permissions`, {
        permissions,
        version,
      })
    ).data,
  deleteRole: async (roleId: string, version: number): Promise<void> => {
    await client.delete(`${base()}/${roleId}`, { params: { version } });
  },
  listMembers: async (roleId: string): Promise<RoleMember[]> =>
    (await client.get<RoleMember[]>(`${base()}/${roleId}/members`)).data,
  addMembers: async (
    roleId: string,
    userIds: string[],
    expiresAt: string | null
  ): Promise<void> => {
    await client.post(`${base()}/${roleId}/members`, { userIds, expiresAt });
  },
  removeMember: async (roleId: string, userId: string): Promise<void> => {
    await client.delete(`${base()}/${roleId}/members/${userId}`);
  },
};
