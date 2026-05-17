'use client';

import { useCallback, useMemo, useState } from 'react';
import type { CategoryNode } from '../tree-state';

interface Result {
  effectiveExpanded: Set<string>;
  matchedIds: Set<string>;
  toggleExpand: (id: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
}

function matches(node: CategoryNode, q: string): boolean {
  const term = q.toLowerCase();
  return (
    node.name.toLowerCase().includes(term) ||
    (node.slug?.toLowerCase().includes(term) ?? false) ||
    (node.description?.toLowerCase().includes(term) ?? false)
  );
}

function collectAncestorsOfMatches(
  nodes: CategoryNode[],
  q: string,
  matched: Set<string>,
  ancestors: Set<string>,
  ancestorStack: string[] = [],
): void {
  for (const n of nodes) {
    if (matches(n, q)) {
      matched.add(n.id);
      for (const a of ancestorStack) ancestors.add(a);
    }
    if (n.children.length) {
      ancestorStack.push(n.id);
      collectAncestorsOfMatches(n.children, q, matched, ancestors, ancestorStack);
      ancestorStack.pop();
    }
  }
}

function collectAllIds(nodes: CategoryNode[], out: Set<string>): void {
  for (const n of nodes) {
    out.add(n.id);
    if (n.children.length) collectAllIds(n.children, out);
  }
}

/**
 * 트리 펼침 상태 관리. 검색어가 비어있을 때는 사용자가 직접 토글한 노드만
 * 펼쳐져 있고, 검색어가 있을 때는 매치 노드의 조상을 자동으로 추가 펼침한다
 * (사용자 토글은 그대로 유지하다가 검색어 비우면 자동 펼침만 사라짐).
 */
export function useTreeExpansion(tree: CategoryNode[], search: string): Result {
  const [userExpanded, setUserExpanded] = useState<Set<string>>(new Set());

  const { matchedIds, searchExpanded } = useMemo(() => {
    const m = new Set<string>();
    const e = new Set<string>();
    if (search.trim()) {
      collectAncestorsOfMatches(tree, search.trim(), m, e);
    }
    return { matchedIds: m, searchExpanded: e };
  }, [tree, search]);

  const effectiveExpanded = useMemo(() => {
    const out = new Set(userExpanded);
    for (const id of searchExpanded) out.add(id);
    return out;
  }, [userExpanded, searchExpanded]);

  const toggleExpand = useCallback((id: string) => {
    setUserExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const all = new Set<string>();
    collectAllIds(tree, all);
    setUserExpanded(all);
  }, [tree]);

  const collapseAll = useCallback(() => setUserExpanded(new Set()), []);

  return { effectiveExpanded, matchedIds, toggleExpand, expandAll, collapseAll };
}
