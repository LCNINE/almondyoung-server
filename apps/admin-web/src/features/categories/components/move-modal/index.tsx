'use client';

import { useState } from 'react';
import { Move } from 'lucide-react';
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
import type { Category } from '@/lib/types/ui/products';

type CategoryMoveButtonProps = {
  category: Category;
};

export function CategoryMoveButton({ category }: CategoryMoveButtonProps) {
  const [open, setOpen] = useState(false);
  const [newParentId, setNewParentId] = useState('');

  const handleMove = async () => {
    console.log('카테고리 이동:', category.id, newParentId);
    // TODO: 실제 API 호출
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="p-1 text-purple-600 hover:text-purple-800 hover:bg-purple-50 rounded"
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
            <p className="text-sm text-gray-600 mb-2">
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
            <Button onClick={handleMove}>이동</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
