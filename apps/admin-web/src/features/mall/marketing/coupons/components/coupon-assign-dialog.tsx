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

  const assignMutation = useAssignCoupon();

  const handleSearch = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setLookupError('');
    setResolvedCustomer(null);
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

  const handleAssign = async () => {
    if (!resolvedCustomer) return;
    try {
      await assignMutation.mutateAsync({
        medusaCustomerId: resolvedCustomer.id,
        promotionIds: [promotionId],
      });
      toast.success(`${resolvedCustomer.email}에게 쿠폰 [${promotionCode}] 발급 완료`);
      handleClose();
    } catch {
      toast.error('쿠폰 발급에 실패했습니다.');
    }
  };

  const handleClose = () => {
    setEmail('');
    setResolvedCustomer(null);
    setLookupError('');
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>취소</Button>
          <Button
            onClick={handleAssign}
            disabled={assignMutation.isPending || !resolvedCustomer}
          >
            {assignMutation.isPending ? '발급 중...' : '발급'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
