import type { ArchiveSpace } from '@/lib/types/dto/archive';

export const archiveQueryKeys = {
  all: ['archive'] as const,
  tree: (space: ArchiveSpace) =>
    [...archiveQueryKeys.all, 'tree', space] as const,
  page: (id: string) => [...archiveQueryKeys.all, 'page', id] as const,
  favorites: () => [...archiveQueryKeys.all, 'favorites'] as const,
  recent: () => [...archiveQueryKeys.all, 'recent'] as const,
  trash: () => [...archiveQueryKeys.all, 'trash'] as const,
  search: (query: string) =>
    [...archiveQueryKeys.all, 'search', query] as const,
  versions: (id: string) => [...archiveQueryKeys.all, 'versions', id] as const,
  version: (id: string, versionId: string) =>
    [...archiveQueryKeys.all, 'versions', id, versionId] as const,
};
