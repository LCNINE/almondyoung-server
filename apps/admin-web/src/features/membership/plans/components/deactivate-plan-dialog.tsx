'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogContent, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { AdminPlan } from '@/lib/api/domains/membership';
import { useDeactivatePlan } from '@/lib/services/membership';

interface DeactivatePlanDialogProps {
  open: boolean;
  onClose: () => void;
  plan: AdminPlan | null;
}

export function DeactivatePlanDialog({ open, onClose, plan }: DeactivatePlanDialogProps) {
  const [reason, setReason] = useState('');
  const deactivate = useDeactivatePlan();

  const handleConfirm = async () => {
    if (!plan) return;
    if (!reason.trim()) return toast.error('비활성화 사유를 입력해주세요.');
    try {
      await deactivate.mutateAsync({ planId: plan.id, reason });
      toast.success('플랜이 비활성화됐습니다.');
      setReason('');
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? '오류가 발생했습니다.');
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>플랜 비활성화</AlertDialogTitle>
          <AlertDialogDescription>
            비활성화된 플랜은 신규 구독에 사용할 수 없습니다. 기존 구독자에게는 영향을 주지 않습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5 py-2">
          <Label>비활성화 사유</Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="사유를 입력해주세요."
            rows={3}
          />
        </div>
        <AlertDialogFooter>
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={deactivate.isPending}>
            비활성화
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
