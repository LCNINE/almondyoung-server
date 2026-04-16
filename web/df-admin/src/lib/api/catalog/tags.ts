import { client } from "../client"
import type {
  CreateTagGroupDto,
  CreateTagValueDto,
  TagGroupDto,
  TagValueDto,
} from "@/lib/types/catalog"

export const tagsApi = {
  listGroups: async (isActive?: boolean): Promise<TagGroupDto[]> => {
    const qs = isActive !== undefined ? `?isActive=${isActive}` : ""
    const response = await client.get(`/tags/groups${qs}`)
    return response.data
  },

  getGroup: async (id: string): Promise<TagGroupDto> => {
    const response = await client.get(`/tags/groups/${id}`)
    return response.data
  },

  createGroup: async (dto: CreateTagGroupDto): Promise<TagGroupDto> => {
    const response = await client.post("/tags/groups", dto)
    return response.data
  },

  updateGroup: async (
    id: string,
    dto: Partial<CreateTagGroupDto>,
  ): Promise<TagGroupDto> => {
    const response = await client.put(`/tags/groups/${id}`, dto)
    return response.data
  },

  deleteGroup: async (id: string): Promise<void> => {
    await client.delete(`/tags/groups/${id}`)
  },

  createValue: async (
    groupId: string,
    dto: CreateTagValueDto,
  ): Promise<TagValueDto> => {
    const response = await client.post(`/tags/groups/${groupId}/values`, dto)
    return response.data
  },

  updateValue: async (
    id: string,
    dto: { name: string },
  ): Promise<TagValueDto> => {
    const response = await client.put(`/tags/values/${id}`, dto)
    return response.data
  },

  deleteValue: async (id: string): Promise<void> => {
    await client.delete(`/tags/values/${id}`)
  },
}
