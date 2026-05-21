'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useEarnPoints } from '@/lib/services/wallet';
import { nowDatetimeLocalMin } from '@/lib/utils/date';
import { toast } from 'sonner';

export function PointsEarnDialog({
  userId,
  open,
  onOpenChange,
}: {
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [amount, setAmount] = useState<number | ''>('');
  const [reasonCode, setReasonCode] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const earnMutation = useEarnPoints();

  const handleEarn = async () => {
    if (!amount || amount <= 0) return;
    try {
      await earnMutation.mutateAsync({
        userId,
        amount: amount as number,
        reasonCode: reasonCode || undefined,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
      toast.success(`적립금 ${(amount as number).toLocaleString('ko-KR')}원 적립 완료`);
      setAmount('');
      setReasonCode('');
      setExpiresAt('');
      onOpenChange(false);
    } catch {
      toast.error('적립금 적립 실패');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>적립금 적립</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>금액</Label>
            <Input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value ? Number(e.target.value) : '')}
              placeholder="적립 금액"
            />
          </div>
          <div className="space-y-2">
            <Label>사유 코드 (선택)</Label>
            <Input
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              placeholder="ADMIN_EARN"
            />
          </div>
          <div className="space-y-2">
            <Label>만료일 (선택)</Label>
            <Input
              type="datetime-local"
              value={expiresAt}
              min={nowDatetimeLocalMin()}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={handleEarn} disabled={earnMutation.isPending || !amount}>
            {earnMutation.isPending ? '적립 중...' : '적립'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
