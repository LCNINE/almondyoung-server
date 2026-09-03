'use client';

import { useQuery } from '@tanstack/react-query';
import { archiveClient } from '@/lib/api/domains/archive';
import type { ArchiveSpace } from '@/lib/types/dto/archive';
import { archiveQueryKeys } from './query-keys';

export const useArchiveTree = (space: ArchiveSpace) => {
  return useQuery({
    queryKey: archiveQueryKeys.tree(space),
    queryFn: () => archiveClient.listTree(space),
    staleTime: 30 * 1000,
  });
};

export const useArchivePage = (id: string | undefined) => {
  return useQuery({
    queryKey: archiveQueryKeys.page(id ?? ''),
    queryFn: () => archiveClient.get(id as string),
    enabled: Boolean(id),
    // 편집 중인 본문을 서버 응답이 덮어쓰면 커서가 튄다. 재조회는 명시적 무효화로만 한다.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
};

export const useArchiveFavorites = () => {
  return useQuery({
    queryKey: archiveQueryKeys.favorites(),
    queryFn: () => archiveClient.listFavorites(),
    staleTime: 30 * 1000,
  });
};

export const useArchiveRecent = () => {
  return useQuery({
    queryKey: archiveQueryKeys.recent(),
    queryFn: () => archiveClient.listRecent(),
    staleTime: 30 * 1000,
  });
};

export const useArchiveTrash = (enabled: boolean) => {
  return useQuery({
    queryKey: archiveQueryKeys.trash(),
    queryFn: () => archiveClient.listTrash(),
    enabled,
    staleTime: 10 * 1000,
  });
};

/** 두 글자 미만은 서버가 거절하므로 아예 보내지 않는다. */
export const useArchiveSearch = (query: string) => {
  const trimmed = query.trim();

  return useQuery({
    queryKey: archiveQueryKeys.search(trimmed),
    queryFn: () => archiveClient.search(trimmed),
    enabled: trimmed.length >= 2,
    staleTime: 15 * 1000,
  });
};

export const useArchiveVersions = (
  id: string | undefined,
  enabled: boolean
) => {
  return useQuery({
    queryKey: archiveQueryKeys.versions(id ?? ''),
    queryFn: () => archiveClient.listVersions(id as string),
    enabled: Boolean(id) && enabled,
    staleTime: 10 * 1000,
  });
};

export const useArchiveVersion = (
  id: string | undefined,
  versionId: string | undefined
) => {
  return useQuery({
    queryKey: archiveQueryKeys.version(id ?? '', versionId ?? ''),
    queryFn: () => archiveClient.getVersion(id as string, versionId as string),
    enabled: Boolean(id) && Boolean(versionId),
    staleTime: Infinity,
  });
};
