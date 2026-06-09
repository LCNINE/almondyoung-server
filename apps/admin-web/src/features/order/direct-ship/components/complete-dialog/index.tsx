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
import { useCompleteDirectShipOrders } from '@/lib/services/orders';

interface Props {
  foIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CompleteDialog({ foIds, open, onOpenChange }: Props) {
  const complete = useCompleteDirectShipOrders();
  const { register, handleSubmit, reset } = useForm<{ completedBy: string }>();

  const onSubmit = async ({ completedBy }: { completedBy: string }) => {
    await complete.mutateAsync({ fulfillmentOrderIds: foIds, completedBy });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>공급사 출고 완료 처리</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            선택된 FO {foIds.length}건을 공급사 출고 완료 처리합니다. 고객 배송 완료(수령)가 아닌 공급사 출고 시점입니다. 처리 담당자명을 입력하세요.
          </p>
          <div className="space-y-1.5">
            <Label>처리 담당자</Label>
            <Input
              {...register('completedBy', { required: true })}
              placeholder="예: 홍길동"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit" disabled={complete.isPending}>
              공급사 출고 완료
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
