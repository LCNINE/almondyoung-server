'use client';

import { Suspense, useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import {
  usePaymentIntentDetail,
  useCaptureIntent,
  useCancelIntent,
  useRefundIntent,
  usePrintStatusByIntent,
  isPrintRefundBlocked,
  PRINT_REFUND_RESTRICTED_NOTE,
  PRINT_PARTIAL_CANCEL_GUIDE,
  PRINT_DEFECT_OVERRIDE_LABEL,
  partialCancelHref,
} from '@/lib/services/wallet';
import Link from 'next/link';
import { Checkbox } from '@/components/ui/checkbox';
import { PaymentMethodTypeCell } from '@/components/table/table-cells/wallet/payment-method-type-cell';
import { UserDetailGeneralContent } from '@/app/(admin)/users/[id]/user-detail-general';
import { toast } from 'sonner';
import { pendingRefundToast } from '@/lib/api/domains/wallet/refund-execution';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TOSS_BANKS } from '@/lib/constants/toss-banks';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

const errMessage = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

function PaymentMethodInfoContent({ intentId }: { intentId: string }) {
  const { data } = usePaymentIntentDetail(intentId);
  const pm = data.paymentMethod;

  return (
    <div className="p-4">
      {pm ? (
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">유형</span>
            <PaymentMethodTypeCell value={pm.type} tossVirtualAccount={data.tossVirtualAccount} />
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
  const printStatus = usePrintStatusByIntent(intentId);
  const hasActivePrint = printStatus.data?.hasActivePrint;
  // 상품 하자 환불이면 와우프레스 주문은 그대로 두고 환불만 한다(인쇄 취소를 보내지 않는다)
  const [defectConfirmed, setDefectConfirmed] = useState(false);
  const printBlocked = isPrintRefundBlocked(hasActivePrint, defectConfirmed);

  const [refundOpen, setRefundOpen] = useState(false);
  const [refundChargeId, setRefundChargeId] = useState('');
  const [refundAmount, setRefundAmount] = useState<number | ''>('');
  const [refundReasonCode, setRefundReasonCode] = useState('');
  const [refundReasonMessage, setRefundReasonMessage] = useState('');
  // 무통장(가상계좌) 환불은 토스에 환불받을 계좌를 넘겨야 자동 송금된다.
  const [refundBank, setRefundBank] = useState('');
  const [refundAccountNumber, setRefundAccountNumber] = useState('');
  const [refundHolderName, setRefundHolderName] = useState('');

  const isBankTransfer = data.paymentMethod?.type === 'BANK_TRANSFER';
  // 무통장 환불은 환불계좌 3필드가 모두 있어야 자동 처리 가능.
  const bankRefundReady = !isBankTransfer || (!!refundBank && !!refundAccountNumber && !!refundHolderName);

  const canCapture = data.status === 'AUTHORIZED';
  // AWAITING_DEPOSIT(무통장 입금대기) 포함 — 미입금 건을 입금확인 전에 거절/취소할 수 있어야 한다.
  // wallet 의 CANCELABLE_INTENT_STATUSES 가 이미 허용하며, 취소 시 선생성 주문 취소 + 예약재고 해제까지
  // 웹훅(handleCancelProjection)이 처리한다.
  const canCancel = [
    'CREATED',
    'PROCESSING',
    'REQUIRES_ACTION',
    'AUTHORIZED',
    'SUCCEEDED',
    'AWAITING_DEPOSIT',
  ].includes(data.status);
  const isAwaitingDeposit = data.status === 'AWAITING_DEPOSIT';

  const succeededCharges = data.charges.filter(
    (c) => c.status === 'SUCCEEDED' && (c.operation === 'AUTHORIZE' || c.operation === 'CAPTURE'),
  );
  const canRefund = succeededCharges.length > 0;

  const amountLabel = `${data.payableAmount.toLocaleString('ko-KR')} ${data.currency}`;

  const handleCapture = async () => {
    try {
      await capture.mutateAsync();
      toast.success('매입 처리 완료');
    } catch (e) {
      toast.error(errMessage(e, '매입 처리 실패'));
    }
  };

  const handleCancel = async () => {
    if (printBlocked) return;
    try {
      await cancel.mutateAsync();
      toast.success(isAwaitingDeposit ? '입금 거절(주문 취소) 완료' : '취소 처리 완료');
    } catch (e) {
      toast.error(errMessage(e, isAwaitingDeposit ? '입금 거절 실패' : '취소 처리 실패'));
    }
  };

  const resetRefundForm = () => {
    setRefundOpen(false);
    setRefundChargeId('');
    setRefundAmount('');
    setRefundReasonCode('');
    setRefundReasonMessage('');
    setRefundBank('');
    setRefundAccountNumber('');
    setRefundHolderName('');
  };

  const handleRefund = async () => {
    if (printBlocked || !refundChargeId || !refundAmount || !bankRefundReady) return;
    try {
      const result = await refund.mutateAsync({
        chargeId: refundChargeId,
        amount: refundAmount as number,
        reasonCode: refundReasonCode || undefined,
        reasonMessage: refundReasonMessage || undefined,
        // 무통장 환불계좌 (있으면 토스가 해당 계좌로 자동 송금)
        refundReceiveAccount: isBankTransfer
          ? { bank: refundBank, accountNumber: refundAccountNumber.replace(/[^0-9]/g, ''), holderName: refundHolderName }
          : undefined,
      });
      if (result.status === 'FAILED') {
        toast.error(`환불 실패: ${result.reasonMessage ?? result.reasonCode ?? 'PG 오류'}`);
        return;
      }
      if (result.status === 'PENDING') {
        toast.info(pendingRefundToast(isBankTransfer));
        resetRefundForm();
        return;
      }
      toast.success('환불 처리 완료');
      resetRefundForm();
    } catch (e) {
      toast.error(errMessage(e, '환불 처리 실패'));
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
        {(canRefund || canCancel) && hasActivePrint !== false && (
          <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
            {hasActivePrint === true ? (
              <>
                <p className="text-xs text-amber-800">{PRINT_REFUND_RESTRICTED_NOTE}</p>
                <p className="text-xs text-amber-800">{PRINT_PARTIAL_CANCEL_GUIDE}</p>
                <Button asChild size="sm" variant="outline" className="w-full">
                  <Link href={partialCancelHref(printStatus.data?.channelOrderId)}>주문내역에서 부분 취소하기</Link>
                </Button>
                <label className="flex items-center gap-2 text-xs text-amber-900">
                  <Checkbox
                    checked={defectConfirmed}
                    onCheckedChange={(checked) => setDefectConfirmed(checked === true)}
                  />
                  {PRINT_DEFECT_OVERRIDE_LABEL}
                </label>
              </>
            ) : (
              <p className="text-xs text-amber-800">
                {printStatus.isError ? '인쇄 주문 상태를 확인하지 못해 환불·결제취소를 막았습니다. 새로고침해 주세요.' : '인쇄 주문 상태를 확인하는 중입니다.'}
              </p>
            )}
          </div>
        )}
        {canCapture && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button className="w-full" disabled={capture.isPending}>
                {capture.isPending ? '처리 중...' : '매입 (Capture)'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>매입(Capture) 처리</AlertDialogTitle>
                <AlertDialogDescription>
                  결제{' '}
                  <span className="font-semibold text-foreground">
                    {amountLabel}
                  </span>{' '}
                  건을 실제로 매입(자금 확정)합니다. 이 작업은 되돌릴 수 없습니다.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={capture.isPending}>
                  취소
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={capture.isPending}
                  onClick={() => void handleCapture()}
                >
                  매입 확정
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {canRefund && (
          <Button
            className="w-full"
            variant="outline"
            onClick={openRefundDialog}
            disabled={printBlocked}
          >
            환불 (Refund)
          </Button>
        )}
        {canCancel && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                className="w-full"
                variant="destructive"
                disabled={cancel.isPending || printBlocked}
              >
                {cancel.isPending
                  ? '처리 중...'
                  : isAwaitingDeposit
                    ? '입금 거절 (주문 취소)'
                    : '취소 (Cancel)'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {isAwaitingDeposit ? '입금 거절(주문 취소) 처리' : '결제 취소 처리'}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {isAwaitingDeposit ? (
                    <>
                      미입금 무통장 건{' '}
                      <span className="font-semibold text-foreground">
                        {amountLabel}
                      </span>{' '}
                      을(를) 거절하고 선생성된 주문을 취소합니다(예약 재고 해제).
                      이 작업은 되돌릴 수 없습니다.
                    </>
                  ) : (
                    <>
                      결제{' '}
                      <span className="font-semibold text-foreground">
                        {amountLabel}
                      </span>{' '}
                      건을 취소(void)합니다. 이 작업은 되돌릴 수 없습니다.
                    </>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={cancel.isPending}>
                  닫기
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={cancel.isPending || printBlocked}
                  onClick={() => void handleCancel()}
                >
                  {isAwaitingDeposit ? '입금 거절' : '취소 확정'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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
            {isBankTransfer && (
              <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs text-amber-700">
                  무통장(가상계좌) 환불 — 환불받을 계좌로 토스가 자동 송금합니다. 예금주명이 정확해야 하며(실명 검증), 약 2영업일 소요됩니다.
                </p>
                <div className="space-y-2">
                  <Label>환불 은행</Label>
                  <select
                    className="w-full border rounded p-2 text-sm"
                    value={refundBank}
                    onChange={(e) => setRefundBank(e.target.value)}
                  >
                    <option value="">은행 선택</option>
                    {TOSS_BANKS.map((b) => (
                      <option key={b.code} value={b.code}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>환불 계좌번호</Label>
                  <Input
                    value={refundAccountNumber}
                    onChange={(e) => setRefundAccountNumber(e.target.value)}
                    placeholder="숫자만 입력"
                    inputMode="numeric"
                  />
                </div>
                <div className="space-y-2">
                  <Label>예금주명</Label>
                  <Input
                    value={refundHolderName}
                    onChange={(e) => setRefundHolderName(e.target.value)}
                    placeholder="예금주명"
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundOpen(false)}>
              취소
            </Button>
            <Button
              onClick={handleRefund}
              disabled={refund.isPending || printBlocked || !refundChargeId || !refundAmount || !bankRefundReady}
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
