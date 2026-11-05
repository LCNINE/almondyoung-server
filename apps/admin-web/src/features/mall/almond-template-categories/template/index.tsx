'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, ImageIcon, Plus } from 'lucide-react';
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
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import { almondTemplateKindLabel } from '../../almond-templates/lib/almond-template-rules';
import { CategoryDialog } from '../components/category-dialog';

type Editing = { category: AlmondTemplateCategoryDto | null } | null;

export default function AlmondTemplateCategoriesTemplate() {
  const { data, isLoading, isError, isFetching, refetch } =
    useAlmondTemplateCategories();
  const reorder = useReorderAlmondTemplateCategories();
  const remove = useDeleteAlmondTemplateCategory();
  const { canRun } = usePermissionCheck();
  const [editing, setEditing] = useState<Editing>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<AlmondTemplateCategoryDto | null>(null);

  const categories = data ?? [];
  const canWrite = canRun(useSaveAlmondTemplateCategory);
  const canReorder = canRun(useReorderAlmondTemplateCategories);
  const canDelete = canRun(useDeleteAlmondTemplateCategory);

  const move = (index: number, offset: -1 | 1) => {
    const ids = categories.map((category) => category.id);
    const target = index + offset;
    [ids[index], ids[target]] = [ids[target], ids[index]];

    reorder.mutate(ids, {
      onError: (e) =>
        toast.error(e instanceof Error ? e.message : '순서를 바꾸지 못했어요.'),
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
            아몬드템플릿 랜딩에 보이는 카드예요. 위에서부터 이 순서대로 보여요.
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

      <ul className="grid gap-2">
        {categories.map((category, index) => {
          const src = resolvePublicFileUrl(category.imageFileId);

          return (
            <li
              key={category.id}
              className="flex items-center gap-4 rounded-lg border bg-white p-3"
            >
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded bg-[#f4f4f5]">
                {src ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={src}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ImageIcon className="h-5 w-5 text-[#c6c6ca]" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{category.name}</p>
                  {!category.isVisible && (
                    <Badge variant="secondary">숨김</Badge>
                  )}
                </div>
                <p className="text-muted-foreground truncate text-[13px]">
                  {category.description ?? '설명 없음'}
                </p>
                <p className="text-muted-foreground text-[12px]">
                  {almondTemplateKindLabel(category.kind)}
                </p>
              </div>

              {canReorder && (
                <div className="flex flex-col gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="위로"
                    disabled={index === 0 || reorder.isPending || isFetching}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="아래로"
                    disabled={
                      index === categories.length - 1 ||
                      reorder.isPending ||
                      isFetching
                    }
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {canWrite && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing({ category })}
                >
                  수정
                </Button>
              )}
              {canDelete && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteTarget(category)}
                >
                  삭제
                </Button>
              )}
            </li>
          );
        })}
      </ul>

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
            <AlertDialogAction onClick={confirmDelete}>
              지우기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
