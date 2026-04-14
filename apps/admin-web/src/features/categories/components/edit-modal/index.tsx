'use client';

import { useState } from 'react';
import { Edit } from 'lucide-react';
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
import { Checkbox } from '@/components/ui/checkbox';
import type { Category } from '@/lib/types/ui/products';

type CategoryEditButtonProps = {
  category: Category;
};

export function CategoryEditButton({ category }: CategoryEditButtonProps) {
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: category.name,
    slug: category.slug,
    description: category.description || '',
    sortOrder: category.sortOrder,
    isActive: category.isActive,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('카테고리 수정:', category.id, formData);
    // TODO: 실제 API 호출
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
          onClick={(e) => e.stopPropagation()}
          aria-label="수정"
        >
          <Edit size={16} />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>카테고리 수정</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">
              카테고리명 <span className="text-red-500">*</span>
            </Label>
            <Input
              id="edit-name"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-slug">슬러그</Label>
            <Input
              id="edit-slug"
              value={formData.slug}
              onChange={(e) =>
                setFormData({ ...formData, slug: e.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-description">설명</Label>
            <Input
              id="edit-description"
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-sortOrder">정렬순서</Label>
            <Input
              id="edit-sortOrder"
              type="number"
              value={formData.sortOrder}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  sortOrder: parseInt(e.target.value) || 0,
                })
              }
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="edit-isActive"
              checked={formData.isActive}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, isActive: checked === true })
              }
            />
            <Label htmlFor="edit-isActive" className="text-sm font-normal">
              활성화
            </Label>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              취소
            </Button>
            <Button type="submit">수정</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
