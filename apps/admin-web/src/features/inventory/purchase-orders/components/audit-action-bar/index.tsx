'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useSubmitForAudit, useApprovePo, useRejectPo } from '@/lib/services/inventory';
import type { PurchaseOrderDto } from '@/lib/types/dto/inventory';
import { toast } from 'sonner';

type Props = {
  po: PurchaseOrderDto;
};

export function AuditActionBar({ po }: Props) {
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);

  const submitMutation = useSubmitForAudit();
  const approveMutation = useApprovePo();
  const rejectMutation = useRejectPo();

  const handleSubmit = async () => {
    try {
      await submitMutation.mutateAsync({ id: po.id, data: {} });
      toast.success('심사 요청이 완료되었습니다.');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '심사 요청에 실패했습니다.');
    }
  };

  const handleApprove = async () => {
    try {
      await approveMutation.mutateAsync({ id: po.id, data: {} });
      toast.success('발주가 승인되었습니다.');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '승인에 실패했습니다.');
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      toast.error('반려 사유를 입력해주세요.');
      return;
    }
    try {
      await rejectMutation.mutateAsync({ id: po.id, data: { rejectionReason: rejectReason } });
      toast.success('발주가 반려되었습니다.');
      setShowRejectForm(false);
      setRejectReason('');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '반려에 실패했습니다.');
    }
  };

  const { auditStatus } = po;

  if (auditStatus === 'draft') {
    return (
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={submitMutation.isPending}
        >
          {submitMutation.isPending ? '요청 중...' : '심사 요청'}
        </Button>
      </div>
    );
  }

  if (auditStatus === 'pending_audit') {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleApprove}
            disabled={approveMutation.isPending || rejectMutation.isPending}
          >
            {approveMutation.isPending ? '승인 중...' : '승인'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowRejectForm((v) => !v)}
            disabled={approveMutation.isPending || rejectMutation.isPending}
          >
            반려
          </Button>
        </div>
        {showRejectForm && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="reject-reason">반려 사유 (필수)</Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="반려 사유를 입력해주세요."
              rows={3}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                onClick={handleReject}
                disabled={rejectMutation.isPending}
              >
                {rejectMutation.isPending ? '반려 중...' : '반려 확정'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setShowRejectForm(false); setRejectReason(''); }}
              >
                취소
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}
