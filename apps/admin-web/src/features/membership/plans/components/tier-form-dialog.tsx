'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AdminTier } from '@/lib/api/domains/membership';
import { useCreateTier, useUpdateTier } from '@/lib/services/membership';

interface TierFormDialogProps {
  open: boolean;
  onClose: () => void;
  tier?: AdminTier;
}

export function TierFormDialog({ open, onClose, tier }: TierFormDialogProps) {
  const isEdit = !!tier;
  const [code, setCode] = useState('');
  const [priorityLevel, setPriorityLevel] = useState('');

  useEffect(() => {
    if (open) {
      setCode(tier?.code ?? '');
      setPriorityLevel(tier?.priorityLevel?.toString() ?? '');
    }
  }, [open, tier]);

  const createTier = useCreateTier();
  const updateTier = useUpdateTier();
  const isPending = createTier.isPending || updateTier.isPending;

  const handleSubmit = async () => {
    const level = Number(priorityLevel);
    if (!isEdit && !code.trim()) return toast.error('티어 코드를 입력해주세요.');
    if (isNaN(level) || level < 1) return toast.error('우선순위를 1 이상으로 입력해주세요.');

    try {
      if (isEdit) {
        await updateTier.mutateAsync({ tierId: tier.id, priorityLevel: level });
      } else {
        await createTier.mutateAsync({ code: code.toUpperCase(), priorityLevel: level });
      }
      toast.success(isEdit ? '티어가 수정됐습니다.' : '티어가 생성됐습니다.');
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? '오류가 발생했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEdit ? '티어 수정' : '티어 추가'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>티어 코드</Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="예: GOLD"
              disabled={isEdit}
            />
            {!isEdit && <p className="text-xs text-muted-foreground">대문자와 언더스코어만 사용 가능합니다.</p>}
          </div>
          <div className="space-y-1.5">
            <Label>우선순위</Label>
            <Input
              type="number"
              value={priorityLevel}
              onChange={(e) => setPriorityLevel(e.target.value)}
              placeholder="1"
              min={1}
              max={100}
            />
            <p className="text-xs text-muted-foreground">숫자가 낮을수록 높은 등급입니다.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isEdit ? '수정' : '추가'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
