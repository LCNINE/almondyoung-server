'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useCouponCustomers, useRevokeCouponFromCustomer } from '@/lib/services/coupons';
import { toast } from 'sonner';
import { Users, UserMinus, Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { CouponCustomer } from '@/lib/api/domains/medusa/promotions';
import { formatCouponDate } from '../coupon-helpers';

function formatCustomerName(c: CouponCustomer) {
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
  return name || c.email;
}

export function CouponCustomersDialog({
  open,
  onOpenChange,
  promotionId,
  promotionCode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  promotionId: string;
  promotionCode: string;
}) {
  const { data, isLoading } = useCouponCustomers(open ? promotionId : null);
  const revoke = useRevokeCouponFromCustomer();
  const [revokeTarget, setRevokeTarget] = useState<CouponCustomer | null>(null);

  const handleRevokeConfirm = async () => {
    if (!revokeTarget) return;
    try {
      await revoke.mutateAsync({ promotionId, customerIds: [revokeTarget.id] });
      toast.success(`${revokeTarget.email}에서 쿠폰을 회수했습니다.`);
    } catch {
      toast.error('쿠폰 회수에 실패했습니다.');
    } finally {
      setRevokeTarget(null);
    }
  };

  const customers = data?.customers ?? [];
  const total = data?.count ?? 0;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              발급 현황
            </DialogTitle>
            <DialogDescription>
              쿠폰{' '}
              <span className="font-mono font-semibold text-foreground">{promotionCode}</span>
              을(를) 발급받은 고객 목록입니다.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-4 rounded-lg border bg-muted/40 px-3 py-2 text-xs">
            <span className="text-muted-foreground">
              총 발급 <span className="font-semibold text-foreground">{total}</span>명
            </span>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : customers.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
              <Users className="h-8 w-8 opacity-30" />
              <p className="text-sm">발급된 고객이 없습니다.</p>
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto divide-y">
              <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-2 px-1 pb-1.5 text-[10px] font-medium text-muted-foreground">
                <span>고객</span>
                <span className="text-right">발급</span>
                <span className="text-right">사용</span>
                <span className="text-right">사용가능</span>
                <span className="text-right">다음 만료</span>
                <span />
              </div>
              {customers.map((customer) => (
                <div
                  key={customer.id}
                  className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-2 px-1 py-2.5"
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-sm font-medium truncate">{formatCustomerName(customer)}</span>
                    <span className="text-xs text-muted-foreground truncate">{customer.email}</span>
                  </div>
                  <span className="text-right text-sm tabular-nums">{customer.granted_count}장</span>
                  <span className="text-right text-sm tabular-nums text-muted-foreground">
                    {customer.used_count}회
                  </span>
                  <Badge
                    variant={customer.usable_count > 0 ? 'outline' : 'secondary'}
                    className="justify-self-end text-[10px] shrink-0"
                  >
                    {customer.usable_count}장
                  </Badge>
                  <span className="text-right text-xs text-muted-foreground shrink-0">
                    {formatCouponDate(customer.next_expires_at) ?? '-'}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setRevokeTarget(customer)}
                    disabled={revoke.isPending}
                    title="쿠폰 회수"
                  >
                    <UserMinus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!revokeTarget} onOpenChange={(open) => { if (!open) setRevokeTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>쿠폰 회수</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-semibold">{revokeTarget?.email}</span> 고객에게서{' '}
              <span className="font-semibold">{revokeTarget?.granted_count ?? 0}장</span>을 회수합니다.
              회수된 쿠폰은 다시 발급해야 사용할 수 있습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevokeConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              회수
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
