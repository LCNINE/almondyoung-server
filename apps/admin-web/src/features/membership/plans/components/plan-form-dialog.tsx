'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AdminPlan, AdminTier } from '@/lib/api/domains/membership';
import { useCreatePlan, useUpdatePlan } from '@/lib/services/membership';

interface PlanFormDialogProps {
  open: boolean;
  onClose: () => void;
  tier: AdminTier;
  plan?: AdminPlan;
}

export function PlanFormDialog({ open, onClose, tier, plan }: PlanFormDialogProps) {
  const isEdit = !!plan;
  const [price, setPrice] = useState('');
  const [durationDays, setDurationDays] = useState('');
  const [trialDays, setTrialDays] = useState('');

  useEffect(() => {
    if (open) {
      setPrice(plan?.price?.toString() ?? '');
      setDurationDays(plan?.durationDays?.toString() ?? '');
      setTrialDays(plan?.trialDays?.toString() ?? '0');
    }
  }, [open, plan]);

  const createPlan = useCreatePlan();
  const updatePlan = useUpdatePlan();
  const isPending = createPlan.isPending || updatePlan.isPending;

  const handleSubmit = async () => {
    const priceNum = Number(price);
    const durationNum = Number(durationDays);
    const trialNum = Number(trialDays);

    if (isNaN(priceNum) || priceNum < 0) return toast.error('가격을 올바르게 입력해주세요.');
    if (isNaN(durationNum) || durationNum < 1) return toast.error('기간을 1일 이상으로 입력해주세요.');
    if (isNaN(trialNum) || trialNum < 0) return toast.error('무료체험 기간을 올바르게 입력해주세요.');

    try {
      if (isEdit) {
        await updatePlan.mutateAsync({ planId: plan.id, price: priceNum, durationDays: durationNum, trialDays: trialNum });
      } else {
        await createPlan.mutateAsync({ tierId: tier.id, price: priceNum, durationDays: durationNum, trialDays: trialNum });
      }
      toast.success(isEdit ? '플랜이 수정됐습니다.' : '플랜이 추가됐습니다.');
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? '오류가 발생했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEdit ? '플랜 수정' : `플랜 추가 — ${tier.code}`}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>가격 (원)</Label>
            <Input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="9900"
              min={0}
            />
          </div>
          <div className="space-y-1.5">
            <Label>기간 (일)</Label>
            <Input
              type="number"
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
              placeholder="30"
              min={1}
            />
          </div>
          <div className="space-y-1.5">
            <Label>무료체험 기간 (일)</Label>
            <Input
              type="number"
              value={trialDays}
              onChange={(e) => setTrialDays(e.target.value)}
              placeholder="0"
              min={0}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isEdit ? '수정' : '추가'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
