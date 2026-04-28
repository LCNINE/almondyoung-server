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
import { useUpdateInboundLineMemo } from '@/lib/services/inventory';
import type { InboundReceiptLineDto } from '@/lib/types/dto/inventory';
import { toast } from 'sonner';

type Props = {
  line: InboundReceiptLineDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function MemoDialog({ line, open, onOpenChange }: Props) {
  const [memo, setMemo] = useState('');
  const mutation = useUpdateInboundLineMemo();

  useEffect(() => {
    if (open) setMemo(line?.memo ?? '');
  }, [open, line]);

  const handleSubmit = async () => {
    if (!line) return;
    if (memo.length > 255) {
      toast.error('메모는 255자 이하여야 합니다.');
      return;
    }
    try {
      await mutation.mutateAsync({ lineId: line.id, data: { memo } });
      toast.success('메모가 저장되었습니다.');
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '메모 저장에 실패했습니다.');
    }
  };

  if (!line) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>메모 수정</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2 py-2">
          <Label>메모 (최대 255자)</Label>
          <Input
            placeholder="메모를 입력하세요"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            maxLength={255}
          />
          <span className="text-right text-xs text-muted-foreground">{memo.length}/255</span>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? '저장 중…' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
