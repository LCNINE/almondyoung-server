'use client';

import { ChevronRight, EyeOff, Plus } from 'lucide-react';
import type { CategoryNode } from '../../tree-state';
import type { DragState } from '../../hooks/use-category-drag';
import { cn } from '@/lib/utils/ui';

interface Props {
  node: CategoryNode;
  depth: number;
  selectedId: string | null;
  effectiveExpanded: Set<string>;
  matchedIds: Set<string>;
  search: string;
  dragState: DragState;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string) => void;
  onAddChild: (parentId: string) => void;
  dragProps: (node: CategoryNode) => React.HTMLAttributes<HTMLDivElement> & {
    draggable: boolean;
  };
}

export function TreeNode({
  node,
  depth,
  selectedId,
  effectiveExpanded,
  matchedIds,
  search,
  dragState,
  onToggleExpand,
  onSelect,
  onAddChild,
  dragProps,
}: Props) {
  const isExpanded = effectiveExpanded.has(node.id);
  const isSelected = selectedId === node.id;
  const isMatch = matchedIds.has(node.id);
  const hasChildren = node.children.length > 0;
  const isDraggingThis = dragState.draggedId === node.id;
  const isDropTarget = dragState.overId === node.id;

  return (
    <div>
      <div
        {...dragProps(node)}
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={hasChildren ? isExpanded : undefined}
        onClick={() => onSelect(node.id)}
        className={cn(
          'group relative flex items-center gap-1 py-1.5 pr-2 text-sm select-none cursor-pointer',
          isSelected ? 'bg-accent' : 'hover:bg-muted/60',
          isDraggingThis && 'opacity-40',
          node.hasPendingMove && 'bg-yellow-50 dark:bg-yellow-900/20',
        )}
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        {isDropTarget && dragState.placement === 'before' && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary" />
        )}
        {isDropTarget && dragState.placement === 'after' && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
        )}
        {isDropTarget && dragState.placement === 'into' && (
          <div className="absolute inset-0 border-2 border-primary rounded-sm pointer-events-none" />
        )}

        <button
          type="button"
          aria-label={isExpanded ? '접기' : '펼치기'}
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggleExpand(node.id);
          }}
          className={cn(
            'inline-flex h-4 w-4 items-center justify-center text-muted-foreground',
            !hasChildren && 'invisible',
          )}
        >
          <ChevronRight
            className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-90')}
          />
        </button>

        <span className={cn('truncate', !node.isActive && 'text-muted-foreground line-through')}>
          {highlight(node.name, search, isMatch)}
        </span>

        {!node.isActive && (
          <EyeOff className="h-3 w-3 text-muted-foreground" aria-label="비활성" />
        )}

        <span className="ml-auto" />

        <button
          type="button"
          aria-label="자식 카테고리 추가"
          onClick={(e) => {
            e.stopPropagation();
            onAddChild(node.id);
          }}
          className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover:opacity-100"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {isExpanded && hasChildren && (
        <div role="group">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              effectiveExpanded={effectiveExpanded}
              matchedIds={matchedIds}
              search={search}
              dragState={dragState}
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
              onAddChild={onAddChild}
              dragProps={dragProps}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function highlight(text: string, search: string, isMatch: boolean) {
  const q = search.trim();
  if (!q || !isMatch) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 dark:bg-yellow-700/60 px-0.5 rounded">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}
