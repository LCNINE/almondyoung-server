'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useCouponCustomers, useRevokeCouponFromCustomer } from '@/lib/services/coupons';
import { toast } from 'sonner';
import { Users, UserMinus, Loader2 } from 'lucide-react';
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

  const handleRevoke = async (customer: CouponCustomer) => {
    try {
      await revoke.mutateAsync({ promotionId, customerIds: [customer.id] });
      toast.success(`${customer.email}에서 쿠폰을 회수했습니다.`);
    } catch {
      toast.error('쿠폰 회수에 실패했습니다.');
    }
  };

  const customers = data?.customers ?? [];
  const total = data?.count ?? 0;

  return (
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

        <p className="py-1 text-sm text-muted-foreground">
          총 <span className="font-semibold text-foreground">{total}</span>명
        </p>

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
            {customers.map((customer) => (
              <div key={customer.id} className="flex items-center justify-between py-2.5 px-1">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-sm font-medium truncate">{formatCustomerName(customer)}</span>
                  <span className="text-xs text-muted-foreground truncate">{customer.email}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <Badge variant="outline" className="text-[10px] text-muted-foreground shrink-0">
                    {formatCouponDate(customer.created_at)}
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleRevoke(customer)}
                    disabled={revoke.isPending}
                    title="쿠폰 회수"
                  >
                    <UserMinus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
