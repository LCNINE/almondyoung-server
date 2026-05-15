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
import { useDeductPoints } from '@/lib/services/wallet';
import { toast } from 'sonner';

export function PointsDeductDialog({
  userId,
  availableBalance,
  open,
  onOpenChange,
}: {
  userId: string;
  availableBalance: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [amount, setAmount] = useState<number | ''>('');
  const [reasonCode, setReasonCode] = useState('');
  const deductMutation = useDeductPoints();

  const handleDeduct = async () => {
    if (!amount || amount <= 0) return;
    try {
      await deductMutation.mutateAsync({ userId, amount: amount as number, reasonCode: reasonCode || undefined });
      toast.success(`포인트 ${(amount as number).toLocaleString('ko-KR')}원 차감 완료`);
      setAmount('');
      setReasonCode('');
      onOpenChange(false);
    } catch {
      toast.error('포인트 차감 실패');
    }
  };

  const isOverBalance = typeof amount === 'number' && amount > availableBalance;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>포인트 차감</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            사용 가능 잔액: <span className="font-medium text-foreground">{availableBalance.toLocaleString('ko-KR')}원</span>
          </p>
          <div className="space-y-2">
            <Label>차감 금액</Label>
            <Input
              type="number"
              min={1}
              max={availableBalance}
              value={amount}
              onChange={(e) => setAmount(e.target.value ? Number(e.target.value) : '')}
              placeholder="차감 금액"
            />
            {isOverBalance && (
              <p className="text-xs text-destructive">사용 가능 잔액을 초과합니다.</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>사유 코드 (선택)</Label>
            <Input
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              placeholder="ADMIN_DEDUCT"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            variant="destructive"
            onClick={handleDeduct}
            disabled={deductMutation.isPending || !amount || isOverBalance}
          >
            {deductMutation.isPending ? '차감 중...' : '차감'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
