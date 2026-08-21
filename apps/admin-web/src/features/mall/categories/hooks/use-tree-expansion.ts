'use client';

import { useCallback, useMemo, useState } from 'react';
import { collectAllIds, collectSearchExpansion } from '@/lib/utils/category-tree';
import type { CategoryNode } from '../tree-state';

interface Result {
  effectiveExpanded: Set<string>;
  matchedIds: Set<string>;
  toggleExpand: (id: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
}

/**
 * 트리 펼침 상태 관리. 검색어가 비어있을 때는 사용자가 직접 토글한 노드만
 * 펼쳐져 있고, 검색어가 있을 때는 매치 노드의 조상을 자동으로 추가 펼침한다
 * (사용자 토글은 그대로 유지하다가 검색어 비우면 자동 펼침만 사라짐).
 *
 * 매칭·순회 규칙은 `@/lib/utils/category-tree` 가 소유한다 — 상품 카테고리
 * 선택기와 같은 규칙을 쓰기 위해서다. 기존 지역 `matches()` 대비 haystack
 * (이름·slug·설명) 의 공백도 무시하므로 매치가 소폭 넓어진다(결과가 줄어드는
 * 방향의 회귀는 없다).
 */
export function useTreeExpansion(tree: CategoryNode[], search: string): Result {
  const [userExpanded, setUserExpanded] = useState<Set<string>>(new Set());

  const { matchedIds, expandedIds } = useMemo(
    () => collectSearchExpansion(tree, search),
    [tree, search]
  );

  const effectiveExpanded = useMemo(() => {
    const out = new Set(userExpanded);
    for (const id of expandedIds) out.add(id);
    return out;
  }, [userExpanded, expandedIds]);

  const toggleExpand = useCallback((id: string) => {
    setUserExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => setUserExpanded(collectAllIds(tree)), [tree]);

  const collapseAll = useCallback(() => setUserExpanded(new Set()), []);

  return { effectiveExpanded, matchedIds, toggleExpand, expandAll, collapseAll };
}
