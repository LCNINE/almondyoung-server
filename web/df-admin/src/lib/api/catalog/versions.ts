import { client } from "../client"
import type { UpdateDraftDto, VersionTreeItem } from "@/lib/types/catalog"

export const versionsApi = {
  list: async (masterId: string): Promise<VersionTreeItem[]> => {
    const response = await client.get(`/masters/${masterId}/versions`)
    return response.data
  },

  get: async (masterId: string, versionId: string) => {
    const response = await client.get(
      `/masters/${masterId}/versions/${versionId}`,
    )
    return response.data
  },

  createDraft: async (
    masterId: string,
    dto?: { parentVersionId?: string; copyMappings?: boolean },
  ) => {
    const response = await client.post(
      `/masters/${masterId}/versions`,
      dto ?? {},
    )
    return response.data
  },

  updateDraft: async (
    masterId: string,
    versionId: string,
    dto: UpdateDraftDto,
  ) => {
    const response = await client.put(
      `/masters/${masterId}/versions/${versionId}`,
      dto,
    )
    return response.data
  },

  publish: async (masterId: string, versionId: string) => {
    const response = await client.patch(
      `/masters/${masterId}/versions/${versionId}/publish`,
    )
    return response.data
  },
}
