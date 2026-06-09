'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useForceShipment } from '@/lib/services/orders/mutations';

interface Props {
  sessionId: string;
  foiId: string;
  authorizedBy: string;
  onClose: () => void;
}

export function ForceShipmentDialog({
  sessionId,
  foiId,
  authorizedBy,
  onClose,
}: Props) {
  const [reason, setReason] = useState('');
  const [forceQty, setForceQty] = useState(1);
  const [note, setNote] = useState('');

  const mutation = useForceShipment();

  const handleSubmit = async () => {
    if (!reason.trim()) {
      toast.error('사유를 입력해주세요.');
      return;
    }
    try {
      await mutation.mutateAsync({
        sessionId,
        foiId,
        reason: reason.trim(),
        authorizedBy,
        forceQty,
        note: note.trim() || undefined,
      });
      toast.success('강제 출고가 승인되었습니다.');
      onClose();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '강제 출고에 실패했습니다.');
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>강제 출고 승인</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label>강제 출고 수량</Label>
            <Input
              type="number"
              min={1}
              value={forceQty}
              onChange={(e) => setForceQty(Number(e.target.value))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>
              사유 <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="강제 출고 사유 입력"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>비고</Label>
            <Textarea
              placeholder="추가 메모 (선택)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            승인자: {authorizedBy}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={mutation.isPending || !reason.trim()}
          >
            {mutation.isPending ? '처리 중…' : '강제 출고'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
