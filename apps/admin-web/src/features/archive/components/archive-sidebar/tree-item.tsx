'use client';

import { memo, useState, type DragEvent, type KeyboardEvent } from 'react';
import {
  ChevronRight,
  FileText,
  MoreHorizontal,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  CornerDownRight,
  CornerLeftUp,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils/ui';
import type { ArchiveTreeNode } from '../../lib/build-tree';

/** 행 안에서 어디에 떨어뜨렸는지 — 위/아래는 형제로, 가운데는 하위로 들어간다. */
export type DropZone = 'before' | 'inside' | 'after';

export type TreeItemActions = {
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onCreateChild: (parentId: string) => void;
  onDelete: (node: ArchiveTreeNode) => void;
  onMoveStep: (node: ArchiveTreeNode, direction: -1 | 1) => void;
  onOutdent: (node: ArchiveTreeNode) => void;
  onIndent: (node: ArchiveTreeNode) => void;
  onDragStart: (node: ArchiveTreeNode) => void;
  onDragEnd: () => void;
  onDrop: (target: ArchiveTreeNode, zone: DropZone) => void;
  canDropOn: (target: ArchiveTreeNode) => boolean;
};

type Props = {
  node: ArchiveTreeNode;
  depth: number;
  activeId: string | undefined;
  expandedIds: Set<string>;
  actions: TreeItemActions;
};

/** 행 높이의 위·아래 이만큼은 «형제로 넣기», 가운데는 «하위로 넣기». */
const EDGE_RATIO = 0.28;

function zoneFromPointer(event: DragEvent<HTMLElement>): DropZone {
  const rect = event.currentTarget.getBoundingClientRect();
  const offset = (event.clientY - rect.top) / rect.height;

  if (offset < EDGE_RATIO) return 'before';
  if (offset > 1 - EDGE_RATIO) return 'after';
  return 'inside';
}

function TreeItemComponent({
  node,
  depth,
  activeId,
  expandedIds,
  actions,
}: Props) {
  const [dropZone, setDropZone] = useState<DropZone | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const expanded = expandedIds.has(node.id);
  const isActive = node.id === activeId;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // 이동 명령은 메뉴에만 있었는데 메뉴 버튼이 탭 순서 밖이라 키보드로는 닿지 않았다.
    // Alt+방향키로 직접 옮기고, 메뉴 자체는 컨텍스트 메뉴 키로 연다.
    if (event.altKey) {
      const move: Record<string, () => void> = {
        ArrowUp: () => actions.onMoveStep(node, -1),
        ArrowDown: () => actions.onMoveStep(node, 1),
        ArrowRight: () => actions.onIndent(node),
        ArrowLeft: () => actions.onOutdent(node),
      };
      const run = move[event.key];
      if (run) {
        event.preventDefault();
        run();
        return;
      }
    }
    if (
      event.key === 'ContextMenu' ||
      (event.shiftKey && event.key === 'F10')
    ) {
      event.preventDefault();
      setMenuOpen(true);
      return;
    }
    if (event.key === 'ArrowRight' && node.children.length > 0 && !expanded) {
      event.preventDefault();
      actions.onToggle(node.id);
      return;
    }
    if (event.key === 'ArrowLeft' && expanded) {
      event.preventDefault();
      actions.onToggle(node.id);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(event.currentTarget, event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      actions.onSelect(node.id);
    }
  };

  return (
    <li role="none">
      <div
        role="treeitem"
        tabIndex={isActive ? 0 : -1}
        aria-expanded={node.children.length > 0 ? expanded : undefined}
        aria-selected={isActive}
        aria-level={depth + 1}
        aria-label={node.title || '제목 없음'}
        draggable
        onKeyDown={handleKeyDown}
        onClick={() => actions.onSelect(node.id)}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          // 파이어폭스는 데이터가 실려 있지 않으면 드래그를 시작하지 않는다.
          event.dataTransfer.setData('text/plain', node.id);
          actions.onDragStart(node);
        }}
        onDragEnd={() => {
          setDropZone(null);
          actions.onDragEnd();
        }}
        onDragOver={(event) => {
          if (!actions.canDropOn(node)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setDropZone(zoneFromPointer(event));
        }}
        onDragLeave={() => setDropZone(null)}
        onDrop={(event) => {
          if (!actions.canDropOn(node)) return;
          event.preventDefault();
          const zone = zoneFromPointer(event);
          setDropZone(null);
          actions.onDrop(node, zone);
        }}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className={cn(
          'group relative flex h-8 cursor-pointer select-none touch-manipulation items-center gap-1 rounded-md pr-1 text-sm',
          'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
          isActive
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-sidebar-foreground hover:bg-sidebar-accent/60',
          dropZone === 'inside' && 'ring-1 ring-inset ring-sidebar-primary'
        )}
      >
        {dropZone === 'before' ? (
          <span className="pointer-events-none absolute inset-x-1 top-0 h-0.5 rounded bg-sidebar-primary" />
        ) : null}
        {dropZone === 'after' ? (
          <span className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded bg-sidebar-primary" />
        ) : null}

        <button
          type="button"
          tabIndex={-1}
          aria-label={expanded ? '하위 페이지 접기' : '하위 페이지 펼치기'}
          onClick={(event) => {
            event.stopPropagation();
            actions.onToggle(node.id);
          }}
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded hover:bg-sidebar-accent',
            node.children.length === 0 && 'invisible'
          )}
        >
          <ChevronRight
            className={cn(
              'size-3.5 transition-transform duration-150',
              expanded && 'rotate-90'
            )}
            aria-hidden
          />
        </button>

        <span className="flex size-5 shrink-0 items-center justify-center text-base leading-none">
          {node.icon ? (
            node.icon
          ) : (
            <FileText className="size-3.5 opacity-60" aria-hidden />
          )}
        </span>

        <span className="min-w-0 flex-1 truncate">
          {node.title || '제목 없음'}
        </span>

        <button
          type="button"
          tabIndex={-1}
          aria-label={`${node.title || '제목 없음'} 안에 하위 페이지 추가`}
          onClick={(event) => {
            event.stopPropagation();
            actions.onCreateChild(node.id);
          }}
          className="flex size-6 shrink-0 items-center justify-center rounded opacity-0 hover:bg-sidebar-accent focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Plus className="size-3.5" aria-hidden />
        </button>

        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              tabIndex={-1}
              aria-label={`${node.title || '제목 없음'} 페이지 메뉴`}
              onClick={(event) => event.stopPropagation()}
              className="flex size-6 shrink-0 items-center justify-center rounded opacity-0 hover:bg-sidebar-accent focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreHorizontal className="size-3.5" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          {/* 드래그가 유일한 이동 수단이면 키보드만 쓰는 사람은 순서를 못 바꾼다(WCAG 2.2 «끌기 동작»). */}
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onSelect={() => actions.onMoveStep(node, -1)}>
              <ArrowUp className="size-4" aria-hidden />
              위로 이동
              <DropdownMenuShortcut>Alt&nbsp;↑</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.onMoveStep(node, 1)}>
              <ArrowDown className="size-4" aria-hidden />
              아래로 이동
              <DropdownMenuShortcut>Alt&nbsp;↓</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.onIndent(node)}>
              <CornerDownRight className="size-4" aria-hidden />위 페이지의
              하위로
              <DropdownMenuShortcut>Alt&nbsp;→</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => actions.onOutdent(node)}
              disabled={!node.parentId}
            >
              <CornerLeftUp className="size-4" aria-hidden />
              상위로 빼기
              <DropdownMenuShortcut>Alt&nbsp;←</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => actions.onDelete(node)}
            >
              <Trash2 className="size-4" aria-hidden />
              휴지통으로
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {expanded && node.children.length > 0 ? (
        <ul role="group">
          {node.children.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              activeId={activeId}
              expandedIds={expandedIds}
              actions={actions}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** 화면에 보이는 행들 사이로 포커스를 옮긴다 — 트리 위젯의 기본 키보드 동작. */
function moveFocus(current: HTMLElement, direction: 1 | -1): void {
  const tree = current.closest('[role="tree"]');
  if (!tree) return;

  const rows = Array.from(
    tree.querySelectorAll<HTMLElement>('[role="treeitem"]')
  );
  const index = rows.indexOf(current);
  const next = rows[index + direction];
  next?.focus();
}

export const TreeItem = memo(TreeItemComponent);
