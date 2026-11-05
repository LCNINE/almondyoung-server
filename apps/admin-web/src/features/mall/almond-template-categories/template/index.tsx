'use client';

import { useState } from 'react';
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
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ImageIcon, Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePermissionCheck } from '@/hooks/use-permission';
import {
  useAlmondTemplateCategories,
  useDeleteAlmondTemplateCategory,
  useReorderAlmondTemplateCategories,
  useSaveAlmondTemplateCategory,
} from '@/lib/services/products';
import type { AlmondTemplateCategoryDto } from '@/lib/types/dto/products';
import { cn } from '@/lib/utils';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import { almondTemplateKindLabel } from '../../almond-templates/lib/almond-template-rules';
import { CategoryDialog } from '../components/category-dialog';

type Editing = { category: AlmondTemplateCategoryDto | null } | null;

type CardProps = {
  category: AlmondTemplateCategoryDto;
  sortable: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
};

// 스토어프론트 랜딩 카드와 같은 모양으로 그린다
function PreviewCard({ category, sortable, onEdit, onDelete }: CardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: category.id, disabled: !sortable });
  const src = resolvePublicFileUrl(category.imageFileId);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group relative text-center',
        isDragging && 'z-10 opacity-80',
        !category.isVisible && 'opacity-50'
      )}
    >
      <div
        {...attributes}
        {...listeners}
        className={cn(
          'relative flex aspect-square w-full items-center justify-center overflow-hidden bg-[#f3f4f5]',
          sortable && 'cursor-grab active:cursor-grabbing'
        )}
      >
        {src ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={src}
            alt=""
            draggable={false}
            className="h-full w-full object-cover"
          />
        ) : (
          <ImageIcon className="h-6 w-6 text-[#c6c6ca]" />
        )}
        {!category.isVisible && (
          <Badge variant="secondary" className="absolute top-2 left-2">
            숨김
          </Badge>
        )}
      </div>

      <p className="mt-4 text-[16px] font-medium text-[#656565]">
        {category.name}
      </p>
      {category.description && (
        <p className="text-[13px] font-light text-[#656565]">
          {category.description}
        </p>
      )}
      <p className="text-muted-foreground mt-1 text-[11px]">
        {almondTemplateKindLabel(category.kind)}
      </p>

      {(onEdit || onDelete) && (
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {onEdit && (
            <Button size="sm" variant="secondary" onClick={onEdit}>
              수정
            </Button>
          )}
          {onDelete && (
            <Button size="sm" variant="secondary" onClick={onDelete}>
              삭제
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

export default function AlmondTemplateCategoriesTemplate() {
  const { data, isLoading, isError, isFetching, refetch } =
    useAlmondTemplateCategories();
  const reorder = useReorderAlmondTemplateCategories();
  const remove = useDeleteAlmondTemplateCategory();
  const { canRun } = usePermissionCheck();
  const [editing, setEditing] = useState<Editing>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<AlmondTemplateCategoryDto | null>(null);
  // 놓자마자 새 순서로 보여 주고, 서버 목록을 다시 받으면 비운다
  const [draftIds, setDraftIds] = useState<string[] | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const fetched = data ?? [];
  const categories = draftIds
    ? draftIds.flatMap((id) => fetched.filter((c) => c.id === id))
    : fetched;
  const canWrite = canRun(useSaveAlmondTemplateCategory);
  const canDelete = canRun(useDeleteAlmondTemplateCategory);
  const sortable =
    canRun(useReorderAlmondTemplateCategories) &&
    !reorder.isPending &&
    !isFetching;

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;

    const ids = categories.map((category) => category.id);
    const next = arrayMove(
      ids,
      ids.indexOf(String(active.id)),
      ids.indexOf(String(over.id))
    );
    setDraftIds(next);

    reorder.mutate(next, {
      onError: (e) =>
        toast.error(e instanceof Error ? e.message : '순서를 바꾸지 못했어요.'),
      onSettled: () => setDraftIds(null),
    });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;

    remove.mutate(deleteTarget.id, {
      onSuccess: () => toast.success('카테고리를 지웠어요.'),
      onError: (e) =>
        toast.error(e instanceof Error ? e.message : '지우지 못했어요.'),
    });
    setDeleteTarget(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-semibold">아몬드템플릿 카테고리</h1>
          <p className="text-muted-foreground text-[13px]">
            랜딩에 보이는 그대로예요. 카드를 끌어다 놓으면 순서가 바뀌고, 카드에
            마우스를 올리면 수정·삭제할 수 있어요.
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => setEditing({ category: null })}>
            <Plus className="h-4 w-4" />
            카테고리 추가
          </Button>
        )}
      </div>

      {isLoading && (
        <p className="text-muted-foreground text-[14px]">불러오는 중</p>
      )}

      {isError && (
        <div className="flex items-center gap-2 text-[14px]">
          카테고리를 불러오지 못했어요.
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            다시 시도
          </Button>
        </div>
      )}

      {!isLoading && !isError && categories.length === 0 && (
        <p className="text-muted-foreground rounded-lg border p-8 text-center text-[14px]">
          아직 카테고리가 없어요. 카테고리가 없으면 랜딩은 기본 카드를 보여
          줘요.
        </p>
      )}

      {categories.length > 0 && (
        <div className="rounded-lg border bg-white px-6 pt-2 pb-10">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={categories.map((category) => category.id)}
              strategy={rectSortingStrategy}
            >
              <ul className="mx-auto grid max-w-[1200px] grid-cols-2 gap-x-4 gap-y-8 pt-6 md:grid-cols-4 md:gap-x-10">
                {categories.map((category) => (
                  <PreviewCard
                    key={category.id}
                    category={category}
                    sortable={sortable}
                    onEdit={
                      canWrite ? () => setEditing({ category }) : undefined
                    }
                    onDelete={
                      canDelete ? () => setDeleteTarget(category) : undefined
                    }
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </div>
      )}

      {editing && (
        <CategoryDialog
          key={editing.category?.id ?? 'new'}
          open
          category={editing.category}
          onClose={() => setEditing(null)}
        />
      )}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget?.name} 카테고리를 지울까요?
            </AlertDialogTitle>
            <AlertDialogDescription>
              랜딩에서 이 카드가 사라져요. 시안은 그대로 남아요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>지우기</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
