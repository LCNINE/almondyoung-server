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
  DialogDescription,
} from '@/components/ui/dialog';
import { useAssignCoupon } from '@/lib/services/coupons';
import { medusaCustomerApi } from '@/lib/api/domains/medusa';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

// 발급 스킵 사유 → 안내 문구
const SKIP_REASON_LABELS: Record<string, string> = {
  inactive: '비활성 쿠폰입니다.',
  automatic: '자동 적용 쿠폰은 수동 발급할 수 없습니다.',
  not_started: '아직 발급 기간이 아닙니다.',
  expired: '기간이 만료된 쿠폰입니다.',
  group_mismatch: '대상 고객 그룹이 아닙니다.',
  max_claims_exceeded: '발급 수량이 소진되었습니다.',
  unknown: '발급할 수 없습니다.',
};

export function CouponAssignDialog({
  promotionId,
  promotionCode,
  open,
  onOpenChange,
}: {
  promotionId: string;
  promotionCode: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [email, setEmail] = useState('');
  const [resolvedCustomer, setResolvedCustomer] = useState<{ id: string; email: string } | null>(null);
  const [lookupError, setLookupError] = useState('');
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [skipReason, setSkipReason] = useState<string | null>(null);

  const assignMutation = useAssignCoupon();

  const handleSearch = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setLookupError('');
    setResolvedCustomer(null);
    setSkipReason(null);
    setIsLookingUp(true);
    try {
      const res = await medusaCustomerApi.getCustomerByEmail(trimmed);
      if (!res.customers || res.customers.length === 0) {
        setLookupError('고객을 찾을 수 없습니다.');
      } else {
        const c = res.customers[0];
        setResolvedCustomer({ id: c.id, email: c.email });
      }
    } catch {
      setLookupError('고객 조회 중 오류가 발생했습니다.');
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleAssign = async (force = false) => {
    if (!resolvedCustomer) return;
    setSkipReason(null);
    try {
      const result = await assignMutation.mutateAsync({
        medusaCustomerId: resolvedCustomer.id,
        promotionIds: [promotionId],
        force,
      });
      if (result.issued.includes(promotionId)) {
        toast.success(`${resolvedCustomer.email}에게 쿠폰 [${promotionCode}] 발급 완료`);
        handleClose();
        return;
      }
      const reason = result.skipped.find((s) => s.promotion_id === promotionId)?.reason;
      if (reason === 'already_issued') {
        toast.info('이미 발급된 고객입니다.');
        handleClose();
        return;
      }
      // 정책상 스킵 → 사유 표시 + 강제 발급 옵션 노출
      setSkipReason(reason ?? 'unknown');
    } catch {
      toast.error('쿠폰 발급에 실패했습니다.');
    }
  };

  const handleClose = () => {
    setEmail('');
    setResolvedCustomer(null);
    setLookupError('');
    setSkipReason(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>쿠폰 발급</DialogTitle>
          <DialogDescription>
            쿠폰 <span className="font-mono font-semibold">{promotionCode}</span>을 고객에게 발급합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>고객 이메일</Label>
            <div className="flex gap-2">
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="customer@example.com"
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleSearch}
                disabled={!email.trim() || isLookingUp}
              >
                {isLookingUp ? '조회 중...' : '조회'}
              </Button>
            </div>
          </div>

          {lookupError && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{lookupError}</span>
            </div>
          )}

          {resolvedCustomer && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{resolvedCustomer.email}</span>
            </div>
          )}

          {skipReason && (
            <div className="flex items-start gap-2 rounded-md bg-amber-50 p-2.5 text-sm text-amber-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{SKIP_REASON_LABELS[skipReason] ?? SKIP_REASON_LABELS.unknown} 강제 발급하시겠습니까?</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>취소</Button>
          {skipReason ? (
            <Button
              variant="destructive"
              onClick={() => handleAssign(true)}
              disabled={assignMutation.isPending || !resolvedCustomer}
            >
              {assignMutation.isPending ? '발급 중...' : '강제 발급'}
            </Button>
          ) : (
            <Button
              onClick={() => handleAssign(false)}
              disabled={assignMutation.isPending || !resolvedCustomer}
            >
              {assignMutation.isPending ? '발급 중...' : '발급'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
