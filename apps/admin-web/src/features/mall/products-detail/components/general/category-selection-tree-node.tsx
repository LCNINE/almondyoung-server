'use client';

import { ChevronRight, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils/ui';
import type { VisibleNode } from '@/lib/utils/category-tree';

export function CategorySelectionTreeRow({
  entry,
  isSelected,
  isPrimary,
  isMatched,
  isFocused,
  disabled,
  onToggleExpand,
  onToggleSelect,
  onSetPrimary,
}: {
  entry: VisibleNode;
  isSelected: boolean;
  isPrimary: boolean;
  isMatched: boolean;
  isFocused: boolean;
  disabled: boolean;
  onToggleExpand: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onSetPrimary: (id: string) => void;
}) {
  const { node, depth, hasChildren, isExpanded, matchedSelf } = entry;
  // 자손 때문에 남은 구조 유지용 노드는 스스로 선택될 수 없다.
  const selectable = matchedSelf && !disabled;
  const checkboxId = `product-category-${node.id}`;

  return (
    <div
      role="treeitem"
      aria-selected={isSelected}
      aria-expanded={hasChildren ? isExpanded : undefined}
      data-focused={isFocused ? 'true' : undefined}
      className={cn(
        'flex min-h-9 items-center gap-2 pr-3 text-sm',
        isSelected && 'bg-muted/60',
        isMatched && 'font-medium',
        !matchedSelf && 'opacity-45',
        isFocused && 'ring-2 ring-ring ring-inset'
      )}
      style={{ paddingLeft: 8 + depth * 16 }}
    >
      {hasChildren ? (
        <button
          type="button"
          aria-label={isExpanded ? '접기' : '펼치기'}
          className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-muted"
          onClick={() => onToggleExpand(node.id)}
        >
          <ChevronRight
            className={cn(
              'size-3.5 transition-transform',
              isExpanded && 'rotate-90'
            )}
          />
        </button>
      ) : (
        <span className="size-5 shrink-0" />
      )}

      <Checkbox
        id={checkboxId}
        checked={isSelected}
        disabled={!selectable}
        onCheckedChange={() => onToggleSelect(node.id)}
      />

      <label
        htmlFor={checkboxId}
        className={cn(
          'min-w-0 flex-1 truncate py-1',
          selectable ? 'cursor-pointer' : 'cursor-default'
        )}
      >
        {node.name}
      </label>

      <div className="flex shrink-0 items-center gap-2">
        {node.slug && (
          <span className="hidden text-xs text-muted-foreground lg:inline">
            {node.slug}
          </span>
        )}
        {!node.isActive && <Badge variant="secondary">비활성</Badge>}
        {node.isVisibleToMembersOnly && (
          <Badge variant="outline">멤버십 전용</Badge>
        )}
        {isSelected && (
          <Button
            type="button"
            size="sm"
            variant={isPrimary ? 'default' : 'outline'}
            disabled={disabled}
            onClick={() => onSetPrimary(node.id)}
          >
            <Star data-icon="inline-start" />
            대표
          </Button>
        )}
      </div>
    </div>
  );
}
