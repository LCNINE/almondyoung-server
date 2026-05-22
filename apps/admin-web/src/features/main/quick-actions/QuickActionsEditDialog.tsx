'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { useEffect, useState } from 'react';
import { QUICK_ACTION_POOL, type QuickActionItem } from './quick-actions.config';
import type { QuickActionPref } from './quick-actions-storage';

interface QuickActionsEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pref: QuickActionPref | null;
  onSave: (pref: QuickActionPref) => void;
}

/** 다이얼로그가 열릴 때 풀을 현재 설정 순서대로 정렬한 초기 리스트를 만든다. */
function buildInitialOrder(pref: QuickActionPref | null): QuickActionItem[] {
  const order = pref?.order ?? [];
  const orderIndex = new Map(order.map((id, i) => [id, i] as const));
  return [...QUICK_ACTION_POOL].sort((a, b) => {
    const ai = orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bi = orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });
}

function SortableRow({
  item,
  visible,
  onToggle,
}: {
  item: QuickActionItem;
  visible: boolean;
  onToggle: (id: string, next: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const Icon = item.icon;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-3 py-2 px-2 rounded-lg border bg-white ${
        isDragging ? 'border-gray-300 shadow-sm opacity-80' : 'border-transparent'
      }`}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-gray-300 hover:text-gray-500"
        aria-label="순서 변경"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <div className={`p-1.5 rounded-md ${item.bg}`}>
        <Icon className={`w-4 h-4 ${item.iconColor}`} />
      </div>
      <span className={`text-sm flex-1 ${visible ? 'text-gray-700' : 'text-gray-300'}`}>
        {item.label}
      </span>
      <Switch
        checked={visible}
        onCheckedChange={(next) => onToggle(item.id, next)}
        aria-label={`${item.label} 표시`}
      />
    </div>
  );
}

export function QuickActionsEditDialog({
  open,
  onOpenChange,
  pref,
  onSave,
}: QuickActionsEditDialogProps) {
  const [items, setItems] = useState<QuickActionItem[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  // 다이얼로그가 열릴 때마다 현재 설정으로 초기화한다.
  useEffect(() => {
    if (open) {
      setItems(buildInitialOrder(pref));
      setHidden(new Set(pref?.hidden ?? []));
    }
  }, [open, pref]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const from = prev.findIndex((i) => i.id === active.id);
      const to = prev.findIndex((i) => i.id === over.id);
      if (from === -1 || to === -1) return prev;
      return arrayMove(prev, from, to);
    });
  };

  const toggle = (id: string, next: boolean) => {
    setHidden((prev) => {
      const updated = new Set(prev);
      if (next) updated.delete(id);
      else updated.add(id);
      return updated;
    });
  };

  const visibleCount = items.filter((i) => !hidden.has(i.id)).length;

  const handleSave = () => {
    onSave({ order: items.map((i) => i.id), hidden: [...hidden] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>빠른 액션 편집</DialogTitle>
          <DialogDescription>
            표시할 메뉴를 켜고, 드래그해서 순서를 바꿀 수 있어요.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[50vh] pr-3">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={items.map((i) => i.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-1">
                {items.map((item) => (
                  <SortableRow
                    key={item.id}
                    item={item}
                    visible={!hidden.has(item.id)}
                    onToggle={toggle}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </ScrollArea>

        <DialogFooter className="flex-row items-center justify-between sm:justify-between">
          <span className="text-xs text-gray-400">{visibleCount}개 표시 중</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button onClick={handleSave}>저장</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
