'use client';

import { useState } from 'react';
import { Move } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMoveCategory } from '@/lib/services/products/mutations';
import type { Category } from '@/lib/types/ui/products';

type CategoryMoveButtonProps = {
  category: Category;
};

export function CategoryMoveButton({ category }: CategoryMoveButtonProps) {
  const [open, setOpen] = useState(false);
  const [newParentId, setNewParentId] = useState('');
  const moveCategory = useMoveCategory();

  const handleMove = async () => {
    try {
      await moveCategory.mutateAsync({
        id: category.id,
        newParentId: newParentId.trim() || undefined,
      });
      toast.success('카테고리가 이동되었습니다.');
      setOpen(false);
      setNewParentId('');
    } catch (error) {
      toast.error('카테고리 이동에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="p-1 text-purple-600 rounded hover:text-purple-800 hover:bg-purple-50"
          onClick={(e) => e.stopPropagation()}
          aria-label="이동"
        >
          <Move size={16} />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>카테고리 이동</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm text-gray-600">
              이동할 카테고리: <strong>{category.name}</strong>
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="newParentId">
              새 부모 카테고리 ID (비워두면 루트로 이동)
            </Label>
            <Input
              id="newParentId"
              value={newParentId}
              onChange={(e) => setNewParentId(e.target.value)}
              placeholder="부모 카테고리 ID 입력"
            />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              취소
            </Button>
            <Button onClick={handleMove} disabled={moveCategory.isPending}>
              {moveCategory.isPending ? '이동 중...' : '이동'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
