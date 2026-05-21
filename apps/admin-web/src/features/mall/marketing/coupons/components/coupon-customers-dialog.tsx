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
import { Users, UserMinus, Loader2, AlertCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CouponCustomer } from '@/lib/api/domains/medusa/promotions';
import { formatCouponDate } from '../coupon-helpers';

function formatCustomerName(c: CouponCustomer) {
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
  return name || c.email;
}

function UsageChip({
  usedCount,
  maxUses,
}: {
  usedCount: number;
  maxUses: number | null;
}) {
  const baseClass = 'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium';

  if (maxUses != null && maxUses > 0) {
    const exhausted = usedCount >= maxUses;
    const colorClass = exhausted
      ? 'bg-red-100 text-red-700'
      : usedCount > 0
        ? 'bg-orange-50 text-orange-700'
        : 'bg-muted text-muted-foreground';
    return (
      <span className={`${baseClass} gap-1 ${colorClass}`}>
        {exhausted && <AlertCircle className="h-3 w-3" />}
        {usedCount}/{maxUses}회
        {exhausted && ' 한도'}
      </span>
    );
  }

  return (
    <span className={`${baseClass} bg-muted text-muted-foreground`}>
      {usedCount > 0 ? `${usedCount}회 사용` : '미사용'}
    </span>
  );
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
  const maxUsesPerCustomer = data?.max_uses_per_customer ?? null;

  const exhaustedCount = useMemo(
    () => maxUsesPerCustomer != null && maxUsesPerCustomer > 0
      ? customers.filter((c) => c.used_count >= maxUsesPerCustomer).length
      : 0,
    [customers, maxUsesPerCustomer],
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
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
            {maxUsesPerCustomer != null && maxUsesPerCustomer > 0 && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">
                  1인 한도 <span className="font-semibold text-foreground">{maxUsesPerCustomer}</span>회
                </span>
                {exhaustedCount > 0 && (
                  <>
                    <span className="text-muted-foreground">·</span>
                    <span className="font-semibold text-red-600">{exhaustedCount}명 한도 도달</span>
                  </>
                )}
              </>
            )}
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
              <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-1 pb-1.5 text-[10px] font-medium text-muted-foreground">
                <span>고객</span>
                <span className="text-right">사용 횟수</span>
                <span className="text-right">발급일</span>
                <span />
              </div>
              {customers.map((customer) => (
                <div
                  key={customer.id}
                  className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-1 py-2.5"
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-sm font-medium truncate">{formatCustomerName(customer)}</span>
                    <span className="text-xs text-muted-foreground truncate">{customer.email}</span>
                  </div>
                  <UsageChip usedCount={customer.used_count} maxUses={maxUsesPerCustomer} />
                  <Badge variant="outline" className="text-[10px] text-muted-foreground shrink-0">
                    {formatCouponDate(customer.issued_at)}
                  </Badge>
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
              <span className="font-semibold">{revokeTarget?.email}</span> 고객에게서 쿠폰을 회수하시겠습니까?
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
