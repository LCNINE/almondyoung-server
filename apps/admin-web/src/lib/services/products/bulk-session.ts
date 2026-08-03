// src/lib/services/products/bulk-session.ts
// 일괄 등록/수정 세션 쿼리·뮤테이션 훅. 판정은 전부 bulk-session-model.ts 가 한다.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { products } from '@/lib/api/domains';
import type {
  BulkImageStatus,
  BulkItemStatus,
  BulkPublishStatus,
  BulkSessionProgress,
  ConflictDecision,
  ConflictFilter,
} from '@/lib/types/dto/bulk-session';
import {
  bulkSessionListRefetchInterval,
  bulkSessionRefetchInterval,
} from './bulk-session-model';
import { productQueryKeys } from './query-keys';

export function useBulkSessionList(page: number, limit: number) {
  return useQuery({
    queryKey: productQueryKeys.bulkSessionList(page, limit),
    queryFn: () => products.bulkSession.list(page, limit),
    refetchInterval: (query) =>
      bulkSessionListRefetchInterval(query.state.data?.data),
  });
}

export function useBulkSessionProgress(id: string) {
  return useQuery({
    queryKey: productQueryKeys.bulkSession(id),
    queryFn: () => products.bulkSession.getProgress(id),
    refetchInterval: (query) => bulkSessionRefetchInterval(query.state.data),
  });
}

export function useBulkSessionItems(
  id: string,
  query: {
    status?: BulkItemStatus;
    conflict?: ConflictFilter;
    publishStatus?: BulkPublishStatus;
    page: number;
    limit: number;
  }
) {
  return useQuery({
    queryKey: productQueryKeys.bulkSessionItems(id, query),
    queryFn: () => products.bulkSession.getItems(id, query),
  });
}

/**
 * 미결정 충돌이 있는 **행 개수**만 필요할 때. 진행률 DTO 를 늘리지 않기로 해서
 * (스펙 §3.1③) limit=1 로 부르고 total 만 읽는다. 폴링 대상이 아니다.
 *
 * **단위 주의**: 여기서 세는 것은 행이다 — 승인(`approve`)이 409 로 거부할 때 세는
 * "결정하지 않은 충돌이 N건"(bulk-session.manager.ts `countUndecided`)은 **필드**
 * 단위라 축이 다르다. 한 행에 미결정 필드가 여럿이면 두 숫자가 어긋난다 — 화면에서
 * 이 값을 쓸 땐 "행"이라고 명시해라(예: review-panel 의 배지).
 */
export function useBulkSessionUndecidedCount(id: string, enabled: boolean) {
  return useQuery({
    queryKey: productQueryKeys.bulkSessionUndecided(id),
    queryFn: () =>
      products.bulkSession.getItems(id, {
        status: 'pending',
        conflict: 'undecided',
        page: 1,
        limit: 1,
      }),
    select: (data) => data.total,
    enabled,
  });
}

export function useBulkSessionImages(
  id: string,
  query: {
    status?: BulkImageStatus;
    onlyRequired?: boolean;
    page: number;
    limit: number;
  }
) {
  return useQuery({
    queryKey: productQueryKeys.bulkSessionImages(id, query),
    queryFn: () => products.bulkSession.getImages(id, query),
  });
}

export function useUploadBulkSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, name }: { file: File; name?: string }) =>
      products.bulkSession.upload(file, name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: productQueryKeys.bulkSessions });
    },
  });
}

/**
 * 진행률 응답인지 구조로 확인한다. `as` 캐스팅 대신 가드를 쓰는 이유는 이 훅이 진행률을
 * 돌려주는 라우트(approve·cancel·publish·retry)와 아이템을 돌려주는 라우트(exclude·
 * conflict-decision)를 **같이** 감싸기 때문이다 — 캐스팅하면 아이템 응답이 진행률 캐시에
 * 들어가 화면이 조용히 깨진다.
 */
function isProgress(value: unknown): value is BulkSessionProgress {
  return (
    typeof value === 'object' &&
    value !== null &&
    'phase' in value &&
    'itemTotal' in value &&
    'itemCounts' in value
  );
}

/**
 * 세션 상태를 바꾸는 뮤테이션들의 공통 후처리 — 진행률과 행 목록을 함께 무효화한다.
 *
 * `TArgs` 를 `void` 로 기본값을 주는 이유: approve·cancel·publish·retryDraft·purgeDrafts 는
 * 인자가 없는 뮤테이션이다. 기본값 없이 두면 인자 없는 mutationFn 에서 TypeScript 가
 * TArgs 를 추론할 근거를 못 찾아 `unknown` 으로 떨어지고, 그러면 반환된 `mutate()` 가
 * (필요 없는데도) 인자를 요구해 화면 쪽 호출이 깨진다. excludeItem·setConflictDecision 처럼
 * 실제 인자가 있는 mutationFn 을 넘기면 그 타입이 그대로 우선 추론된다.
 */
function useSessionMutation<TArgs = void, TResult = unknown>(
  id: string,
  mutationFn: (args: TArgs) => Promise<TResult>
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (result) => {
      // 진행률을 돌려주는 라우트는 재조회 없이 캐시를 갱신한다.
      if (isProgress(result)) {
        qc.setQueryData(productQueryKeys.bulkSession(id), result);
      } else {
        void qc.invalidateQueries({
          queryKey: productQueryKeys.bulkSession(id),
        });
      }
      void qc.invalidateQueries({
        queryKey: [...productQueryKeys.bulkSession(id), 'items'],
      });
      void qc.invalidateQueries({
        queryKey: productQueryKeys.bulkSessionUndecided(id),
      });
    },
  });
}

export function useSetConflictDecision(id: string) {
  return useSessionMutation(
    id,
    ({
      itemId,
      decisions,
    }: {
      itemId: string;
      decisions: Record<string, ConflictDecision>;
    }) => products.bulkSession.setConflictDecision(id, itemId, decisions)
  );
}

export function useApproveBulkSession(id: string) {
  return useSessionMutation(id, () => products.bulkSession.approve(id));
}

export function useCancelBulkSession(id: string) {
  return useSessionMutation(id, () => products.bulkSession.cancel(id));
}

export function usePublishBulkSession(id: string) {
  return useSessionMutation(id, () => products.bulkSession.publish(id));
}

export function useRetryDraft(id: string) {
  return useSessionMutation(id, () => products.bulkSession.retryDraft(id));
}

export function useExcludeItem(id: string) {
  return useSessionMutation(id, (itemId: string) =>
    products.bulkSession.excludeItem(id, itemId)
  );
}

export function usePurgeDrafts(id: string) {
  return useSessionMutation(id, () => products.bulkSession.purgeDrafts(id));
}

export function useResolveImages(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      resolutions: Parameters<typeof products.bulkSession.resolveImages>[1]
    ) => products.bulkSession.resolveImages(id, resolutions),
    onSuccess: (response) => {
      // 전량 게이트가 열렸으면 응답의 progress 가 이미 drafting 이다 — 폴링을 기다리지 않는다.
      qc.setQueryData(productQueryKeys.bulkSession(id), response.progress);
      void qc.invalidateQueries({
        queryKey: [...productQueryKeys.bulkSession(id), 'images'],
      });
    },
  });
}
