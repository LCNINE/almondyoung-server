'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useGrantOwnership } from '@/lib/services/library';
import type { GrantOwnershipDto } from '@/lib/types/dto/library';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const EMPTY: GrantOwnershipDto = { customerId: '', assetId: '', salesOrderId: '' };

export function OwnershipGrantDialog({ open, onOpenChange }: Props) {
  const [form, setForm] = useState<GrantOwnershipDto>(EMPTY);
  const grantMutation = useGrantOwnership();

  const canSubmit =
    Boolean(form.customerId.trim()) &&
    Boolean(form.assetId.trim()) &&
    Boolean(form.salesOrderId.trim()) &&
    !grantMutation.isPending;

  const handleClose = () => {
    setForm(EMPTY);
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      await grantMutation.mutateAsync({
        customerId: form.customerId.trim(),
        assetId: form.assetId.trim(),
        salesOrderId: form.salesOrderId.trim(),
      });
      toast.success('사용권을 부여했습니다.');
      handleClose();
    } catch {
      toast.error('부여에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : handleClose())}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>사용권 수동 부여</DialogTitle>
          <DialogDescription>
            특정 고객에게 자산 사용권을 직접 부여합니다. 동일 (고객·자산·주문) 조합은
            멱등 처리됩니다.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="grant-customer">고객 ID</Label>
            <Input
              id="grant-customer"
              placeholder="customer UUID"
              value={form.customerId}
              onChange={(e) => setForm((p) => ({ ...p, customerId: e.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="grant-asset">자산 ID</Label>
            <Input
              id="grant-asset"
              placeholder="asset UUID"
              value={form.assetId}
              onChange={(e) => setForm((p) => ({ ...p, assetId: e.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="grant-order">주문 ID</Label>
            <Input
              id="grant-order"
              placeholder="sales order UUID"
              value={form.salesOrderId}
              onChange={(e) => setForm((p) => ({ ...p, salesOrderId: e.target.value }))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            부여
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
