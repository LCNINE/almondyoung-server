'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useDeleteCategory } from '@/lib/services/products/mutations';
import type { Category } from '@/lib/types/ui/products';

type CategoryDeleteButtonProps = {
  category: Category;
};

export function CategoryDeleteButton({ category }: CategoryDeleteButtonProps) {
  const [open, setOpen] = useState(false);
  const deleteCategory = useDeleteCategory();

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      await deleteCategory.mutateAsync({ id: category.id });
      toast.success('카테고리가 삭제되었습니다.');
      setOpen(false);
    } catch (error) {
      toast.error('카테고리 삭제에 실패했습니다.');
    }
  };

  const hasChildren = category.children && category.children.length > 0;

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <button
          className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
          onClick={(e) => e.stopPropagation()}
          aria-label="삭제"
        >
          <Trash2 size={16} />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>카테고리 삭제</AlertDialogTitle>
          <AlertDialogDescription>
            정말로 &quot;{category.name}&quot; 카테고리를 삭제하시겠습니까?
            <br />
            이 작업은 되돌릴 수 없습니다.
            {hasChildren && (
              <span className="block mt-2 text-red-600">
                하위 카테고리가 있어 삭제할 수 없습니다.
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteCategory.isPending}>
            취소
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            className="bg-red-600 hover:bg-red-700"
            disabled={hasChildren || deleteCategory.isPending}
          >
            {deleteCategory.isPending ? '삭제 중...' : '삭제'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
