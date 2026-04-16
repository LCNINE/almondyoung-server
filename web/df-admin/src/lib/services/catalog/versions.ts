import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { versionsApi } from "@/lib/api/catalog/versions"
import type { UpdateDraftDto } from "@/lib/types/catalog"
import { catalogKeys } from "./query-keys"

export function useVersions(masterId: string) {
  return useQuery({
    queryKey: catalogKeys.versions.list(masterId),
    queryFn: () => versionsApi.list(masterId),
    enabled: !!masterId,
  })
}

export function useVersion(masterId: string, versionId: string) {
  return useQuery({
    queryKey: catalogKeys.versions.detail(masterId, versionId),
    queryFn: () => versionsApi.get(masterId, versionId),
    enabled: !!masterId && !!versionId,
  })
}

export function useCreateDraft(masterId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dto?: { parentVersionId?: string; copyMappings?: boolean }) =>
      versionsApi.createDraft(masterId, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogKeys.versions.list(masterId) })
      qc.invalidateQueries({ queryKey: catalogKeys.products.detail(masterId) })
    },
  })
}

export function useUpdateDraft(masterId: string, versionId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dto: UpdateDraftDto) =>
      versionsApi.updateDraft(masterId, versionId, dto),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: catalogKeys.versions.detail(masterId, versionId),
      })
      qc.invalidateQueries({ queryKey: catalogKeys.products.detail(masterId) })
    },
  })
}

export function usePublishVersion(masterId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (versionId: string) =>
      versionsApi.publish(masterId, versionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogKeys.versions.list(masterId) })
      qc.invalidateQueries({ queryKey: catalogKeys.products.detail(masterId) })
      qc.invalidateQueries({ queryKey: catalogKeys.products.all })
    },
  })
}
