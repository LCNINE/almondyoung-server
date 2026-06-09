'use client';

import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useForwardDirectShipOrders } from '@/lib/services/orders';

interface Props {
  foIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ForwardDialog({ foIds, open, onOpenChange }: Props) {
  const forward = useForwardDirectShipOrders();
  const { register, handleSubmit, reset } = useForm<{ companyName: string }>();

  const onSubmit = async ({ companyName }: { companyName: string }) => {
    await forward.mutateAsync({ fulfillmentOrderIds: foIds, companyName });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>공급사 전달</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            선택된 FO {foIds.length}건을 공급사에 전달합니다. directShipStatus가 &apos;forwarded&apos;로 전환됩니다.
          </p>
          <div className="space-y-1.5">
            <Label>공급사 / 직배송 업체명</Label>
            <Input
              {...register('companyName', { required: true })}
              placeholder="예: 나이키코리아"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit" disabled={forward.isPending}>
              공급사 전달
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
