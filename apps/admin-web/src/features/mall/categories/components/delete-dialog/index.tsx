'use client';

import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDeleteCategory } from '@/lib/services/products/mutations';
import { toast } from 'sonner';
import { useCategoryDetail } from '../../hooks/use-category-detail';
import {
  type CategoryNode,
  descendantIdsOf,
  findNode,
  flattenNodes,
} from '../../tree-state';

interface Props {
  categoryId: string | null;
  tree: CategoryNode[];
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}

type Mode = 'transfer' | 'detach';

/**
 * ADR 0003 의 삭제 정책을 UI 로 풀어낸 dialog.
 *  - 자식 차단: detail 의 children 길이로 사전 차단.
 *  - 매핑 0건: 단순 확인.
 *  - 매핑 N건: 라디오로 (이전 / 끊기) 선택. 이전 시 대상 카테고리 셀렉터.
 */
export function CategoryDeleteDialog({ categoryId, tree, onOpenChange, onDeleted }: Props) {
  const open = !!categoryId;
  const detail = useCategoryDetail(categoryId);
  const remove = useDeleteCategory();
  const [mode, setMode] = useState<Mode>('transfer');
  const [transferTo, setTransferTo] = useState<string>('');

  const node = useMemo(
    () => (categoryId ? findNode(tree, categoryId) : undefined),
    [tree, categoryId],
  );

  const transferCandidates = useMemo(() => {
    if (!node) return [] as CategoryNode[];
    const excluded = descendantIdsOf(node);
    excluded.add(node.id);
    return flattenNodes(tree).filter((n) => !excluded.has(n.id));
  }, [tree, node]);

  const hasChildren = (detail.data?.children?.length ?? 0) > 0;
  const productCount = detail.data?.productCount ?? 0;
  const hasMappedProducts = productCount > 0;

  const onConfirm = async () => {
    if (!categoryId) return;
    if (hasMappedProducts && mode === 'transfer' && !transferTo) {
      toast.error('이전 대상 카테고리를 선택하세요.');
      return;
    }
    try {
      await remove.mutateAsync({
        id: categoryId,
        moveProductsTo:
          hasMappedProducts && mode === 'transfer' ? transferTo : undefined,
      });
      toast.success('카테고리가 삭제되었습니다.');
      onDeleted();
      onOpenChange(false);
    } catch (e) {
      toast.error(extractMessage(e) ?? '삭제에 실패했습니다.');
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {detail.data?.name ? `"${detail.data.name}" 삭제` : '카테고리 삭제'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {detail.isLoading
              ? '카테고리 정보를 불러오는 중입니다.'
              : hasChildren
                ? '자식 카테고리가 있어 삭제할 수 없습니다. 먼저 자식을 옮기거나 삭제하세요.'
                : hasMappedProducts
                  ? `이 카테고리에 매핑된 상품이 ${productCount}개 있습니다. 어떻게 처리할지 선택하세요.`
                  : '되돌릴 수 없습니다. 정말 삭제하시겠어요?'}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {!detail.isLoading && !hasChildren && hasMappedProducts && (
          <div className="space-y-3">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="delete-mode"
                checked={mode === 'transfer'}
                onChange={() => setMode('transfer')}
                className="mt-1"
              />
              <div className="space-y-2">
                <span>다른 카테고리로 이전</span>
                {mode === 'transfer' && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">이전 대상</Label>
                    <Select value={transferTo} onValueChange={setTransferTo}>
                      <SelectTrigger className="h-8 w-full">
                        <SelectValue placeholder="카테고리 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {transferCandidates.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </label>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="delete-mode"
                checked={mode === 'detach'}
                onChange={() => setMode('detach')}
                className="mt-1"
              />
              <div>
                <span>매핑만 끊기</span>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  상품은 살고 이 카테고리 태깅만 제거됩니다.
                </p>
              </div>
            </label>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>취소</AlertDialogCancel>
          <AlertDialogAction
            disabled={hasChildren || detail.isLoading || remove.isPending}
            onClick={(e) => {
              e.preventDefault();
              void onConfirm();
            }}
          >
            {remove.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            삭제
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function extractMessage(e: unknown): string | undefined {
  if (typeof e === 'object' && e && 'message' in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return undefined;
}
