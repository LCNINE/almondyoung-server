'use client';

import { useState } from 'react';
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
  DialogDescription,
} from '@/components/ui/dialog';
import { useBatchEarnPoints } from '@/lib/services/wallet';
import { nowDatetimeLocalMin } from '@/lib/utils/date';
import { toast } from 'sonner';
import { CheckCircle2, XCircle } from 'lucide-react';

export function PointsBatchEarnDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [rawUserIds, setRawUserIds] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [reasonCode, setReasonCode] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [result, setResult] = useState<{ succeeded: string[]; failed: Array<{ userId: string; reason: string }> } | null>(null);

  const batchMutation = useBatchEarnPoints();

  const userIds = rawUserIds
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const handleSubmit = async () => {
    if (!amount || amount <= 0 || userIds.length === 0) return;
    if (userIds.length > 1000) {
      toast.error('최대 1,000명까지 일괄 지급할 수 있습니다.');
      return;
    }
    try {
      const res = await batchMutation.mutateAsync({
        userIds,
        amount: amount as number,
        reasonCode: reasonCode || undefined,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
      setResult(res);
      toast.success(`${res.succeeded.length}명 지급 완료${res.failed.length ? `, ${res.failed.length}명 실패` : ''}`);
    } catch {
      toast.error('일괄 지급 실패');
    }
  };

  const handleClose = () => {
    setRawUserIds('');
    setAmount('');
    setReasonCode('');
    setExpiresAt('');
    setResult(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>적립금 일괄 지급</DialogTitle>
          <DialogDescription>
            여러 사용자에게 동일 금액의 적립금을 한 번에 지급합니다. (최대 1,000명)
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>사용자 ID 목록</Label>
              <Textarea
                value={rawUserIds}
                onChange={(e) => setRawUserIds(e.target.value)}
                placeholder={'user-id-1\nuser-id-2\nuser-id-3\n또는 쉼표로 구분'}
                rows={6}
                className="font-mono text-sm"
              />
              {userIds.length > 0 && (
                <p className="text-xs text-muted-foreground">{userIds.length}명 입력됨</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>1인당 지급 금액</Label>
              <Input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value ? Number(e.target.value) : '')}
                placeholder="예: 1000"
              />
            </div>

            <div className="space-y-2">
              <Label>사유 코드 (선택)</Label>
              <Input
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                placeholder="PROMOTION_EVENT"
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
        ) : (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              <span>성공: {result.succeeded.length}명</span>
            </div>
            {result.failed.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <XCircle className="h-4 w-4" />
                  <span>실패: {result.failed.length}명</span>
                </div>
                <div className="rounded border bg-muted/50 p-2 max-h-32 overflow-y-auto">
                  {result.failed.map((f) => (
                    <p key={f.userId} className="text-xs font-mono text-muted-foreground">
                      {f.userId}: {f.reason}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {result ? '닫기' : '취소'}
          </Button>
          {!result && (
            <Button
              onClick={handleSubmit}
              disabled={batchMutation.isPending || !amount || userIds.length === 0}
            >
              {batchMutation.isPending ? `지급 중... (${userIds.length}명)` : `${userIds.length}명에게 지급`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
