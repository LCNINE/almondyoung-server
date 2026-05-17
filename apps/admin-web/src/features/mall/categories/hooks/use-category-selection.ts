'use client';

import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

export type SelectionMode =
  | { kind: 'none' }
  | { kind: 'selected'; id: string }
  | { kind: 'create'; parentId: string | null };

/**
 * URL ↔ split-view 선택 상태 어댑터.
 *
 * - `?selected=<id>` 로 한 카테고리 상세 선택.
 * - `?mode=create&parent=<id|root>` 로 임시(저장 전) 새 카테고리 편집.
 *
 * 페이지 자체는 같은 컴포넌트 마운트 상태이므로 좌측 트리의 펜딩/펼침 상태가
 * 보존된다. `router.replace` 를 쓰는 이유는 브라우저 히스토리에 매 클릭이
 * 쌓이지 않도록 하기 위함 (split-view 의 선택은 페이지 이동이 아니라 상태 변화).
 */
export function useCategorySelection() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const mode = useMemo<SelectionMode>(() => {
    const modeParam = params.get('mode');
    if (modeParam === 'create') {
      const parent = params.get('parent');
      return {
        kind: 'create',
        parentId: parent && parent !== 'root' ? parent : null,
      };
    }
    const selected = params.get('selected');
    if (selected) return { kind: 'selected', id: selected };
    return { kind: 'none' };
  }, [params]);

  const replace = useCallback(
    (next: URLSearchParams) => {
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const select = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params.toString());
      next.delete('mode');
      next.delete('parent');
      next.set('selected', id);
      replace(next);
    },
    [params, replace],
  );

  const startCreate = useCallback(
    (parentId: string | null) => {
      const next = new URLSearchParams(params.toString());
      next.delete('selected');
      next.set('mode', 'create');
      next.set('parent', parentId ?? 'root');
      replace(next);
    },
    [params, replace],
  );

  const clear = useCallback(() => {
    const next = new URLSearchParams(params.toString());
    next.delete('mode');
    next.delete('parent');
    next.delete('selected');
    replace(next);
  }, [params, replace]);

  return { mode, select, startCreate, clear };
}
