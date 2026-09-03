'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { archiveClient } from '@/lib/api/domains/archive';
import type {
  ArchivePageDetailDto,
  ArchivePageSaveResultDto,
  ArchiveSpace,
  CreateArchivePageDto,
  MoveArchivePageDto,
  UpdateArchivePageDto,
} from '@/lib/types/dto/archive';
import { archiveQueryKeys } from './query-keys';

/** 트리·최근 문서처럼 «목록» 성격의 캐시만 털어낸다. 열려 있는 본문은 건드리지 않는다. */
function invalidateLists(
  queryClient: ReturnType<typeof useQueryClient>,
  space: ArchiveSpace
): void {
  queryClient.invalidateQueries({ queryKey: archiveQueryKeys.tree(space) });
  queryClient.invalidateQueries({ queryKey: archiveQueryKeys.recent() });
  queryClient.invalidateQueries({ queryKey: archiveQueryKeys.favorites() });
}

/**
 * 저장한 값을 상세 캐시에 그대로 되써 넣는다.
 *
 * 서버 응답에는 본문이 없고(`ArchivePageSaveResultDto`), 상세 조회는 `staleTime: Infinity` 라
 * 여기서 안 넣으면 캐시의 `content` 가 «문서를 처음 연 순간의 값»에 영원히 묶인다.
 * 그러면 다른 문서에 갔다 돌아왔을 때 방금 쓴 본문이 없는 편집기가 뜨고,
 * 거기서 한 글자만 쳐도 그 빈 본문이 서버의 진짜 본문을 덮는다.
 */
export function writeBackSavedPage(
  queryClient: ReturnType<typeof useQueryClient>,
  id: string,
  dto: UpdateArchivePageDto,
  result?: ArchivePageSaveResultDto
): void {
  queryClient.setQueryData<ArchivePageDetailDto>(
    archiveQueryKeys.page(id),
    (previous) => {
      if (!previous) return previous;

      const next: ArchivePageDetailDto = result
        ? {
            ...previous,
            title: result.title,
            icon: result.icon,
            coverUrl: result.coverUrl,
            updatedAt: result.updatedAt,
            updatedBy: result.updatedBy,
          }
        : { ...previous };

      // 보낸 것만 반영한다 — 제목만 저장한 요청이 본문을 건드리면 안 된다.
      if (dto.content !== undefined) next.content = dto.content;
      if (dto.contentMarkdown !== undefined)
        next.contentMarkdown = dto.contentMarkdown;

      return next;
    }
  );
}

/**
 * 컴포넌트가 사라지는 순간의 저장.
 * useMutation 의 콜백은 옵저버가 이미 떨어져 나갔을 수 있으므로, 요청과 캐시 정리를
 * 직접 부른다 — «떠나면서 마지막 한 글자를 잃는» 경로를 훅 수명에 맡기지 않는다.
 */
export async function flushArchivePageUpdate(
  queryClient: ReturnType<typeof useQueryClient>,
  id: string,
  space: ArchiveSpace,
  dto: UpdateArchivePageDto
): Promise<void> {
  try {
    const result = await archiveClient.update(id, dto);
    writeBackSavedPage(queryClient, id, dto, result);
    invalidateLists(queryClient, space);
  } catch {
    // 화면이 이미 없어 알릴 곳이 없다. 캐시가 서버와 갈렸을 수 있으니 다음 조회에서 다시 읽는다.
    queryClient.invalidateQueries({ queryKey: archiveQueryKeys.page(id) });
  }
}

export const useCreateArchivePage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CreateArchivePageDto) => archiveClient.create(dto),
    onSuccess: (page) => {
      queryClient.setQueryData(archiveQueryKeys.page(page.id), page);
      invalidateLists(queryClient, page.space);
    },
  });
};

/**
 * 자동 저장. 서버가 돌려주는 건 저장 결과(제목·수정시각)뿐이므로, 본문은 서버 응답이 아니라
 * «방금 보낸 것»으로 캐시를 맞춘다 — 편집 중인 블록을 다시 조회한 값으로 덮으면 커서가 튄다.
 */
export const useUpdateArchivePage = (space: ArchiveSpace) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateArchivePageDto }) =>
      archiveClient.update(id, dto),
    onSuccess: (result, variables) => {
      writeBackSavedPage(queryClient, result.id, variables.dto, result);
      invalidateLists(queryClient, space);
    },
  });
};

export const useMoveArchivePage = (space: ArchiveSpace) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: MoveArchivePageDto }) =>
      archiveClient.move(id, dto),
    onSuccess: (tree) => {
      queryClient.setQueryData(archiveQueryKeys.tree(space), tree);
      queryClient.invalidateQueries({ queryKey: archiveQueryKeys.recent() });
    },
  });
};

export const useDeleteArchivePage = (space: ArchiveSpace) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => archiveClient.remove(id),
    onSuccess: (result) => {
      for (const id of result.removedIds) {
        queryClient.removeQueries({ queryKey: archiveQueryKeys.page(id) });
      }
      invalidateLists(queryClient, space);
      queryClient.invalidateQueries({ queryKey: archiveQueryKeys.trash() });
    },
  });
};

export const useRestoreArchivePage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => archiveClient.restore(id),
    onSuccess: (page) => {
      queryClient.setQueryData(archiveQueryKeys.page(page.id), page);
      invalidateLists(queryClient, page.space);
      queryClient.invalidateQueries({ queryKey: archiveQueryKeys.trash() });
    },
  });
};

export const usePurgeArchivePage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => archiveClient.purge(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: archiveQueryKeys.trash() });
    },
  });
};

export const useToggleArchiveFavorite = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, favorite }: { id: string; favorite: boolean }) =>
      archiveClient.setFavorite(id, favorite),
    onSuccess: (result, variables) => {
      queryClient.setQueryData<ArchivePageDetailDto>(
        archiveQueryKeys.page(variables.id),
        (previous) =>
          previous ? { ...previous, isFavorite: result.isFavorite } : previous
      );
      queryClient.invalidateQueries({ queryKey: archiveQueryKeys.favorites() });
    },
  });
};

export const useRestoreArchiveVersion = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, versionId }: { id: string; versionId: string }) =>
      archiveClient.restoreVersion(id, versionId),
    onSuccess: (page) => {
      queryClient.setQueryData(archiveQueryKeys.page(page.id), page);
      queryClient.invalidateQueries({
        queryKey: archiveQueryKeys.versions(page.id),
      });
      invalidateLists(queryClient, page.space);
    },
  });
};
