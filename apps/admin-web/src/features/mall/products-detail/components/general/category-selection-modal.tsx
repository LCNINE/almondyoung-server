'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { cn } from '@/lib/utils/ui';
import type { SelectableCategory } from './basic-information-model';

function sortCategoryIds(
  ids: string[],
  options: SelectableCategory[]
): string[] {
  const selected = new Set(ids);
  return options
    .filter((option) => selected.has(option.id))
    .map((option) => option.id);
}

export function ProductCategorySelectionModal({
  open,
  onOpenChange,
  options,
  isLoading,
  selectedIds,
  primaryCategoryId,
  disabled,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: SelectableCategory[];
  isLoading: boolean;
  selectedIds: string[];
  primaryCategoryId: string | null;
  disabled: boolean;
  onApply: (categoryIds: string[], primaryCategoryId: string | null) => void;
}) {
  const [search, setSearch] = useState('');
  const [draftIds, setDraftIds] = useState<string[]>(selectedIds);
  const [draftPrimaryId, setDraftPrimaryId] = useState<string | null>(
    primaryCategoryId
  );

  useEffect(() => {
    if (open) {
      setSearch('');
      setDraftIds(selectedIds);
      setDraftPrimaryId(primaryCategoryId);
    }
  }, [open, primaryCategoryId, selectedIds]);

  const selectedSet = useMemo(() => new Set(draftIds), [draftIds]);
  const selectedOptions = useMemo(
    () => options.filter((option) => selectedSet.has(option.id)),
    [options, selectedSet]
  );
  const applyDisabled = disabled || isLoading;
  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) =>
      [option.name, option.slug, option.pathLabel].some((value) =>
        value?.toLowerCase().includes(q)
      )
    );
  }, [options, search]);

  const handleSelect = (id: string, checked: boolean) => {
    setDraftIds((current) => {
      const next = checked
        ? sortCategoryIds([...current, id], options)
        : current.filter((categoryId) => categoryId !== id);

      setDraftPrimaryId((currentPrimary) => {
        if (next.length === 0) return null;
        if (currentPrimary && next.includes(currentPrimary))
          return currentPrimary;
        return next[0];
      });

      return next;
    });
  };

  const handleApply = () => {
    const categoryIds = sortCategoryIds(draftIds, options);
    onApply(
      categoryIds,
      draftPrimaryId && categoryIds.includes(draftPrimaryId)
        ? draftPrimaryId
        : (categoryIds[0] ?? null)
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!flex max-h-[calc(100vh-2rem)] !max-w-4xl flex-col gap-0 p-0 sm:!max-w-4xl">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>카테고리 선택</DialogTitle>
          <DialogDescription>
            상품을 노출할 카테고리를 선택하고 대표 카테고리를 지정합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="border-y px-6 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="카테고리명, slug, 경로 검색"
              className="pl-9"
              disabled={applyDisabled}
            />
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 px-6 py-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <ScrollArea className="h-[430px] rounded-md border">
            {isLoading ? (
              <div className="flex h-full min-h-[240px] items-center justify-center">
                <Spinner />
              </div>
            ) : filteredOptions.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">
                검색 결과가 없습니다.
              </div>
            ) : (
              <div className="divide-y">
                {filteredOptions.map((option) => {
                  const checked = selectedSet.has(option.id);
                  const checkboxId = `product-category-${option.id}`;

                  return (
                    <div
                      key={option.id}
                      className={cn(
                        'flex min-h-12 items-center gap-3 px-3 py-2',
                        checked && 'bg-muted/60'
                      )}
                    >
                      <Checkbox
                        id={checkboxId}
                        checked={checked}
                        disabled={applyDisabled}
                        onCheckedChange={(nextChecked) =>
                          handleSelect(option.id, nextChecked === true)
                        }
                      />
                      <label
                        htmlFor={checkboxId}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm"
                        style={{ paddingLeft: `${option.depth * 16}px` }}
                      >
                        <span className="truncate">{option.pathLabel}</span>
                        {!option.isActive && (
                          <Badge variant="secondary">비활성</Badge>
                        )}
                      </label>
                      {checked && (
                        <Button
                          type="button"
                          size="sm"
                          variant={
                            draftPrimaryId === option.id ? 'default' : 'outline'
                          }
                          disabled={applyDisabled}
                          onClick={() => setDraftPrimaryId(option.id)}
                        >
                          <Star data-icon="inline-start" />
                          대표
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          <div className="flex min-h-[220px] flex-col gap-3 rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <Label>선택됨</Label>
              <span className="text-sm text-muted-foreground">
                {selectedOptions.length}개
              </span>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              {selectedOptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  선택된 카테고리가 없습니다.
                </p>
              ) : (
                <div className="flex flex-col gap-2 pr-2">
                  {selectedOptions.map((option) => (
                    <div
                      key={option.id}
                      className="rounded-md border px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-sm">
                          {option.pathLabel}
                        </p>
                        {draftPrimaryId === option.id && <Badge>대표</Badge>}
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
          <Button type="button" disabled={applyDisabled} onClick={handleApply}>
            적용
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
