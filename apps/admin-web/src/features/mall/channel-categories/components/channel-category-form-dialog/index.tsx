'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useCreateChannelCategory, useUpdateChannelCategory } from '@/lib/services/products';
import type { ChannelCategoryDto } from '@/lib/types/dto/products';

type Props = {
  category?: ChannelCategoryDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ChannelCategoryFormDialog({ category, open, onOpenChange }: Props) {
  const createMutation = useCreateChannelCategory();
  const updateMutation = useUpdateChannelCategory();

  const isEdit = !!category;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [displayOrder, setDisplayOrder] = useState(0);

  useEffect(() => {
    if (category) {
      setName(category.name);
      setDescription(category.description ?? '');
      setDisplayOrder(category.displayOrder);
    } else {
      setName('');
      setDescription('');
      setDisplayOrder(0);
    }
  }, [category]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('분류명을 입력해주세요.');
      return;
    }
    try {
      if (isEdit && category) {
        await updateMutation.mutateAsync({
          id: category.id,
          data: {
            name,
            description: description || undefined,
            displayOrder,
          },
        });
        toast.success('채널 카테고리가 수정되었습니다.');
      } else {
        await createMutation.mutateAsync({
          name,
          description: description || undefined,
          displayOrder,
        });
        toast.success('채널 카테고리가 생성되었습니다.');
      }
      onOpenChange(false);
    } catch {
      toast.error(isEdit ? '수정에 실패했습니다.' : '생성에 실패했습니다.');
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEdit ? '채널 카테고리 수정' : '채널 카테고리 생성'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>분류명</Label>
            <Input
              placeholder="예: 엘나산, 3PL"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </div>
          <div className="space-y-1">
            <Label>설명 (선택)</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>정렬 순서</Label>
            <Input
              type="number"
              value={displayOrder}
              onChange={(e) => setDisplayOrder(Number(e.target.value))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? '저장 중…' : isEdit ? '수정' : '생성'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
