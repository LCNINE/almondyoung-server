'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Star, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import {
  collectAncestorIds,
  collectAllIds,
  collectSearchExpansion,
  orderedCategoryIds,
  pruneTree,
  resolveKeyboardMove,
  visibleNodeSequence,
  type CategoryTreeNodeLike,
} from '@/lib/utils/category-tree';
import {
  buildCategoryPathLabels,
  createVisibilityPredicate,
  setPrimaryCategory,
  toggleCategorySelection,
  type CategorySelectionState,
} from './category-selection-model';
import {
  categoryTreeRowId,
  CategorySelectionTreeRow,
} from './category-selection-tree-node';

export function ProductCategorySelectionModal({
  open,
  onOpenChange,
  tree,
  isLoading,
  selectedIds,
  primaryCategoryId,
  disabled,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tree: CategoryTreeNodeLike[];
  isLoading: boolean;
  selectedIds: string[];
  primaryCategoryId: string | null;
  disabled: boolean;
  onApply: (categoryIds: string[], primaryCategoryId: string | null) => void;
}) {
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [userExpanded, setUserExpanded] = useState<Set<string>>(new Set());
  const [focusIndex, setFocusIndex] = useState(-1);
  const [draft, setDraft] = useState<CategorySelectionState>({
    selectedIds,
    primaryId: primaryCategoryId,
  });
  const listRef = useRef<HTMLDivElement>(null);

  // 열릴 때마다 초기화한다. 펼침은 "이미 선택된 것들의 조상"에서 시작해야
  // 열자마자 무엇을 골라놨는지 트리에서 보인다.
  useEffect(() => {
    if (!open) return;
    setSearch('');
    setIncludeInactive(false);
    setFocusIndex(-1);
    setDraft({ selectedIds, primaryId: primaryCategoryId });
    setUserExpanded(collectAncestorIds(tree, selectedIds));
  }, [open, tree, selectedIds, primaryCategoryId]);

  const busy = disabled || isLoading;
  const draftSelectedSet = useMemo(() => new Set(draft.selectedIds), [draft.selectedIds]);
  const orderedIds = useMemo(() => orderedCategoryIds(tree), [tree]);
  const pathLabels = useMemo(() => buildCategoryPathLabels(tree), [tree]);

  const { matchedIds, expandedIds } = useMemo(
    () => collectSearchExpansion(tree, search),
    [tree, search]
  );

  const pruned = useMemo(
    () =>
      pruneTree(
        tree,
        createVisibilityPredicate({
          query: search,
          includeInactive,
          selectedIds: draftSelectedSet,
        })
      ),
    [tree, search, includeInactive, draftSelectedSet]
  );

  const effectiveExpanded = useMemo(() => {
    const out = new Set(userExpanded);
    for (const id of expandedIds) out.add(id);
    return out;
  }, [userExpanded, expandedIds]);

  const sequence = useMemo(
    () => visibleNodeSequence(pruned, effectiveExpanded),
    [pruned, effectiveExpanded]
  );

  // role="tree" 계약: 화살표로 포커스가 옮겨갈 때 그 행이 뷰포트 안에 있어야
  // 키보드 내비게이션이 실제로 쓸 수 있다. 긴 목록에서는 스크롤이 필수다.
  useEffect(() => {
    if (focusIndex < 0) return;
    const entry = sequence[focusIndex];
    if (!entry) return;
    const rowId = categoryTreeRowId(entry.node.id);
    const row = listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(rowId)}`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [focusIndex, sequence]);

  const toggleExpand = useCallback((id: string) => {
    setUserExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelect = useCallback(
    (id: string) => {
      setDraft((prev) => toggleCategorySelection(prev, id, orderedIds));
    },
    [orderedIds]
  );

  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const move = resolveKeyboardMove(sequence, focusIndex, event.key);
    if (!move) return;
    event.preventDefault();
    if (move.nextIndex !== undefined) setFocusIndex(move.nextIndex);
    if (move.toggleExpandId) toggleExpand(move.toggleExpandId);
    if (move.selectId) toggleSelect(move.selectId);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowDown' || sequence.length === 0) return;
    event.preventDefault();
    setFocusIndex(0);
    listRef.current?.focus();
  };

  const handleApply = () => {
    onApply(draft.selectedIds, draft.primaryId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!flex h-[92vh] !max-w-[96vw] flex-col gap-0 p-0 sm:!max-w-[96vw]">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>카테고리 선택</DialogTitle>
          <DialogDescription>
            상품을 노출할 카테고리를 선택하고 대표 카테고리를 지정합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 border-y px-6 py-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="카테고리명·slug·경로 검색 (예: 바디 크림)"
              className="pl-9"
              disabled={busy}
            />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              id="category-include-inactive"
              checked={includeInactive}
              onCheckedChange={setIncludeInactive}
              disabled={busy}
            />
            <Label htmlFor="category-include-inactive" className="text-sm">
              비활성 포함
            </Label>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setUserExpanded(new Set())}
          >
            모두 접기
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setUserExpanded(collectAllIds(tree))}
          >
            모두 펼치기
          </Button>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 px-6 py-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-h-0 rounded-md border">
            <ScrollArea className="h-full">
              {isLoading ? (
                <div className="flex min-h-[240px] items-center justify-center">
                  <Spinner />
                </div>
              ) : sequence.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">
                  조건에 맞는 카테고리가 없습니다.
                </div>
              ) : (
                <div
                  ref={listRef}
                  role="tree"
                  tabIndex={0}
                  onKeyDown={handleTreeKeyDown}
                  aria-activedescendant={
                    focusIndex >= 0 && sequence[focusIndex]
                      ? categoryTreeRowId(sequence[focusIndex].node.id)
                      : undefined
                  }
                  className="divide-y outline-none"
                >
                  {sequence.map((entry, index) => (
                    <CategorySelectionTreeRow
                      key={entry.node.id}
                      entry={entry}
                      // 체크박스는 selectable(=matchedSelf && !disabled) 로 이미
                      // 잠겨 있다. isSelected 는 실제 선택 상태를 그대로 반영해야
                      // "잠긴 채 체크됨" 이 정직하게 보인다 — 토글 자체(키보드
                      // Space/Enter 는 resolveKeyboardMove, 대표 버튼은 disabled)는
                      // 다른 층에서 막는다.
                      isSelected={draftSelectedSet.has(entry.node.id)}
                      isPrimary={draft.primaryId === entry.node.id}
                      isMatched={matchedIds.has(entry.node.id)}
                      isFocused={focusIndex === index}
                      disabled={busy}
                      onToggleExpand={toggleExpand}
                      onToggleSelect={toggleSelect}
                      onSetPrimary={(id) =>
                        setDraft((prev) => setPrimaryCategory(prev, id))
                      }
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          <div className="flex min-h-0 flex-col gap-3 rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <Label>선택됨</Label>
              <span className="text-sm text-muted-foreground">
                {draft.selectedIds.length}개
              </span>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              {draft.selectedIds.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  선택된 카테고리가 없습니다.
                </p>
              ) : (
                <div className="flex flex-col gap-2 pr-2">
                  {draft.selectedIds.map((id) => (
                    <div key={id} className="rounded-md border px-3 py-2">
                      <div className="flex items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-sm">
                          {pathLabels.get(id) ?? id}
                        </p>
                        {draft.primaryId === id && <Badge>대표</Badge>}
                      </div>
                      <div className="mt-2 flex justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant={draft.primaryId === id ? 'default' : 'ghost'}
                          disabled={busy}
                          onClick={() =>
                            setDraft((prev) => setPrimaryCategory(prev, id))
                          }
                        >
                          <Star data-icon="inline-start" />
                          대표
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label="선택 해제"
                          disabled={busy}
                          onClick={() =>
                            setDraft((prev) =>
                              toggleCategorySelection(prev, id, orderedIds)
                            )
                          }
                        >
                          <X data-icon="inline-start" />
                          제거
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => onOpenChange(false)}
          >
            취소
          </Button>
          <Button type="button" disabled={busy} onClick={handleApply}>
            적용
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
