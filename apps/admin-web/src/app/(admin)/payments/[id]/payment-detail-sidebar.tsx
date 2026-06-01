'use client';

import { Suspense, useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { usePaymentIntentDetail, useCaptureIntent, useCancelIntent, useRefundIntent } from '@/lib/services/wallet';
import { PaymentMethodTypeCell } from '@/components/table/table-cells/wallet/payment-method-type-cell';
import { UserDetailGeneralContent } from '@/app/(admin)/users/[id]/user-detail-general';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function PaymentMethodInfoContent({ intentId }: { intentId: string }) {
  const { data } = usePaymentIntentDetail(intentId);
  const pm = data.paymentMethod;

  return (
    <div className="p-4">
      {pm ? (
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">유형</span>
            <PaymentMethodTypeCell value={pm.type} />
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">표시명</span>
            <span>{pm.displayName ?? '-'}</span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">결제수단 없음</p>
      )}
    </div>
  );
}

function PaymentMethodInfo({ intentId }: { intentId: string }) {
  return (
    <Container className="divide-y">
      <Header title="결제수단" />
      <Suspense fallback={<div className="flex justify-center p-4"><Spinner /></div>}>
        <PaymentMethodInfoContent intentId={intentId} />
      </Suspense>
    </Container>
  );
}

function ActionButtonsContent({ intentId }: { intentId: string }) {
  const { data } = usePaymentIntentDetail(intentId);
  const capture = useCaptureIntent(intentId);
  const cancel = useCancelIntent(intentId);
  const refund = useRefundIntent(intentId);

  const [refundOpen, setRefundOpen] = useState(false);
  const [refundChargeId, setRefundChargeId] = useState('');
  const [refundAmount, setRefundAmount] = useState<number | ''>('');
  const [refundReasonCode, setRefundReasonCode] = useState('');
  const [refundReasonMessage, setRefundReasonMessage] = useState('');

  const canCapture = data.status === 'AUTHORIZED';
  const canCancel = ['CREATED', 'PROCESSING', 'REQUIRES_ACTION', 'AUTHORIZED', 'SUCCEEDED'].includes(data.status);

  const succeededCharges = data.charges.filter(
    (c) => c.status === 'SUCCEEDED' && (c.operation === 'AUTHORIZE' || c.operation === 'CAPTURE'),
  );
  const canRefund = succeededCharges.length > 0;

  const handleCapture = async () => {
    try {
      await capture.mutateAsync();
      toast.success('매입 처리 완료');
    } catch {
      toast.error('매입 처리 실패');
    }
  };

  const handleCancel = async () => {
    try {
      await cancel.mutateAsync();
      toast.success('취소 처리 완료');
    } catch {
      toast.error('취소 처리 실패');
    }
  };

  const handleRefund = async () => {
    if (!refundChargeId || !refundAmount) return;
    try {
      const result = await refund.mutateAsync({
        chargeId: refundChargeId,
        amount: refundAmount as number,
        reasonCode: refundReasonCode || undefined,
        reasonMessage: refundReasonMessage || undefined,
      });
      if (result.status === 'FAILED') {
        toast.error(`환불 실패: ${result.reasonMessage ?? result.reasonCode ?? 'PG 오류'}`);
        return;
      }
      if (result.status === 'PENDING') {
        toast.info('환불 대기 중: 무통장 입금 환불은 수동 송금이 필요합니다. 환불 내역에서 완료 처리해 주세요.');
        setRefundOpen(false);
        setRefundChargeId('');
        setRefundAmount('');
        setRefundReasonCode('');
        setRefundReasonMessage('');
        return;
      }
      toast.success('환불 처리 완료');
      setRefundOpen(false);
      setRefundChargeId('');
      setRefundAmount('');
      setRefundReasonCode('');
      setRefundReasonMessage('');
    } catch {
      toast.error('환불 처리 실패');
    }
  };

  const openRefundDialog = () => {
    if (succeededCharges.length === 1) {
      setRefundChargeId(succeededCharges[0]!.id);
    }
    setRefundOpen(true);
  };

  if (!canCapture && !canCancel && !canRefund) return null;

  return (
    <>
      <div className="p-4 space-y-2">
        {canCapture && (
          <Button
            className="w-full"
            onClick={handleCapture}
            disabled={capture.isPending}
          >
            {capture.isPending ? '처리 중...' : '매입 (Capture)'}
          </Button>
        )}
        {canRefund && (
          <Button
            className="w-full"
            variant="outline"
            onClick={openRefundDialog}
          >
            환불 (Refund)
          </Button>
        )}
        {canCancel && (
          <Button
            className="w-full"
            variant="destructive"
            onClick={handleCancel}
            disabled={cancel.isPending}
          >
            {cancel.isPending ? '처리 중...' : '취소 (Cancel)'}
          </Button>
        )}
      </div>

      <Dialog open={refundOpen} onOpenChange={setRefundOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>환불 처리</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {succeededCharges.length > 1 && (
              <div className="space-y-2">
                <Label>Charge 선택</Label>
                <select
                  className="w-full border rounded p-2 text-sm"
                  value={refundChargeId}
                  onChange={(e) => setRefundChargeId(e.target.value)}
                >
                  <option value="">선택하세요</option>
                  {succeededCharges.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.id.slice(0, 8)}... ({c.operation}, {c.amount.toLocaleString('ko-KR')}원)
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-2">
              <Label>환불 금액</Label>
              <Input
                type="number"
                min={1}
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value ? Number(e.target.value) : '')}
                placeholder="환불 금액"
              />
            </div>
            <div className="space-y-2">
              <Label>사유 코드 (선택)</Label>
              <Input
                value={refundReasonCode}
                onChange={(e) => setRefundReasonCode(e.target.value)}
                placeholder="ADMIN_REFUND"
              />
            </div>
            <div className="space-y-2">
              <Label>사유 메시지 (선택)</Label>
              <Input
                value={refundReasonMessage}
                onChange={(e) => setRefundReasonMessage(e.target.value)}
                placeholder="관리자 환불 처리"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundOpen(false)}>
              취소
            </Button>
            <Button
              onClick={handleRefund}
              disabled={refund.isPending || !refundChargeId || !refundAmount}
            >
              {refund.isPending ? '처리 중...' : '환불 실행'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ActionButtons({ intentId }: { intentId: string }) {
  return (
    <Container className="divide-y">
      <Header title="액션" />
      <Suspense fallback={<div className="flex justify-center p-4"><Spinner /></div>}>
        <ActionButtonsContent intentId={intentId} />
      </Suspense>
    </Container>
  );
}

function UserInfoContent({ intentId }: { intentId: string }) {
  const { data } = usePaymentIntentDetail(intentId);

  if (!data.userId) return null;

  return (
    <Container className="divide-y">
      <Header title="회원 기본 정보" />
      <Suspense fallback={<div className="flex justify-center p-4"><Spinner /></div>}>
        <UserDetailGeneralContent userId={data.userId} />
      </Suspense>
    </Container>
  );
}

function UserInfo({ intentId }: { intentId: string }) {
  return (
    <Suspense fallback={<div className="flex justify-center p-4"><Spinner /></div>}>
      <UserInfoContent intentId={intentId} />
    </Suspense>
  );
}

export function PaymentDetailSidebar({ intentId }: { intentId: string }) {
  return (
    <div className="flex w-full flex-col gap-y-3">
      <UserInfo intentId={intentId} />
      <PaymentMethodInfo intentId={intentId} />
      <ActionButtons intentId={intentId} />
    </div>
  );
}
