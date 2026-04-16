import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { tagsApi } from "@/lib/api/catalog/tags"
import type { CreateTagGroupDto, CreateTagValueDto } from "@/lib/types/catalog"
import { catalogKeys } from "./query-keys"

export function useTagGroups(isActive?: boolean) {
  return useQuery({
    queryKey: catalogKeys.tags.groups(isActive),
    queryFn: () => tagsApi.listGroups(isActive),
  })
}

export function useTagGroup(id: string) {
  return useQuery({
    queryKey: catalogKeys.tags.group(id),
    queryFn: () => tagsApi.getGroup(id),
    enabled: !!id,
  })
}

export function useCreateTagGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateTagGroupDto) => tagsApi.createGroup(dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogKeys.tags.all })
    },
  })
}

export function useUpdateTagGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      dto,
    }: {
      id: string
      dto: Partial<CreateTagGroupDto>
    }) => tagsApi.updateGroup(id, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogKeys.tags.all })
    },
  })
}

export function useDeleteTagGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => tagsApi.deleteGroup(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogKeys.tags.all })
    },
  })
}

export function useCreateTagValue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      groupId,
      dto,
    }: {
      groupId: string
      dto: CreateTagValueDto
    }) => tagsApi.createValue(groupId, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogKeys.tags.all })
    },
  })
}

export function useDeleteTagValue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => tagsApi.deleteValue(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogKeys.tags.all })
    },
  })
}
