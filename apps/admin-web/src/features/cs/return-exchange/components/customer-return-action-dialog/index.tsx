'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { parseServerError } from '@/lib/api/server-error';
import {
  useCancelCustomerReturn,
  useCloseCustomerReturnMissing,
  useRequestCustomerReturnPrepay,
  useRestartCustomerReturn,
  useReturnSettlementPreview,
  useSettleHeldCustomerReturn,
} from '@/lib/services/customer-returns';
import type { CustomerReturnView, RestartCustomerReturnBody } from '@/lib/types/dto/customer-returns';
import type { CustomerReturnAction } from '../../customer-return-actions';
import { parseNonNegativeAmount, parsePrepayAmount, requiredMemo } from '../../customer-return-action-input';
import { RETURN_ACTION_LABELS } from '../../customer-return-labels';
import { formatWon } from '../format';

interface Props {
  view: CustomerReturnView;
  action: CustomerReturnAction;
  onClose: () => void;
}

const RESTART_TARGET = {
  retrySettlement: ['settlement', 'retry'],
  manualSettlement: ['settlement', 'manual'],
  retryPrepayment: ['prepayment', 'retry'],
  manualPrepayment: ['prepayment', 'manual'],
} as const;

export function CustomerReturnActionDialog({ view, action, onClose }: Props) {
  const { kind } = action;
  const orderId = view.order.channelOrderId;
  const returnId = view.channelReturnId;

  const cancel = useCancelCustomerReturn();
  const closeMissing = useCloseCustomerReturnMissing();
  const settleHeld = useSettleHeldCustomerReturn();
  const prepay = useRequestCustomerReturnPrepay();
  const restart = useRestartCustomerReturn();

  // 미리보기는 금액을 정하는 두 대화상자가 열려 있을 때만 부른다
  const preview = useReturnSettlementPreview(orderId, returnId, { enabled: kind === 'settleHeld' || kind === 'prepay' });

  const [memo, setMemo] = useState('');
  const [deductionText, setDeductionText] = useState('');
  const [amountText, setAmountText] = useState<string | null>(null);
  const [refundMode, setRefundMode] = useState<'auto' | 'manual'>('auto');
  const [alreadyText, setAlreadyText] = useState('');
  const [dropConfirmed, setDropConfirmed] = useState(false);

  const itemValue = preview.data?.itemValue;
  const prepayText = amountText ?? (preview.data ? String(preview.data.defaultPrepayAmount) : '');
  const deduction = parseNonNegativeAmount(deductionText);
  const prepayAmount = parsePrepayAmount(prepayText, itemValue);
  const already = parseNonNegativeAmount(alreadyText);
  const memoValue = requiredMemo(memo);

  const restartBody = (): RestartCustomerReturnBody | undefined => {
    if (action.needs === 'alreadyRefundedAmount' && already !== null) return { alreadyRefundedAmount: already };
    if (action.needs === 'dropHoldDeduction') return { dropHoldDeduction: true };
    return undefined;
  };

  const ready = (() => {
    switch (kind) {
      case 'closeMissing':
        return memoValue !== null;
      case 'settleHeld':
        return deduction !== null && memoValue !== null;
      case 'prepay':
        return prepayAmount !== null && memoValue !== null;
      case 'retrySettlement':
        if (action.needs === 'alreadyRefundedAmount') return already !== null;
        if (action.needs === 'dropHoldDeduction') return dropConfirmed;
        return true;
      default:
        return true;
    }
  })();

  const mutations = [cancel, closeMissing, settleHeld, prepay, restart];
  const pending = mutations.some((m) => m.isPending);

  const done = (message: string) => ({
    onSuccess: () => {
      toast.success(message);
      onClose();
    },
    onError: (e: unknown) => toast.error(parseServerError(e).message),
  });

  const submit = () => {
    switch (kind) {
      case 'cancel':
        return cancel.mutate({ orderId, returnId }, done('취소했습니다. 목록에는 몇 분 뒤 반영됩니다.'));
      case 'closeMissing':
        if (memoValue === null) return;
        return closeMissing.mutate({ id: view.id, body: { memo: memoValue } }, done('미도착으로 닫았습니다.'));
      case 'settleHeld':
        if (deduction === null || memoValue === null) return;
        return settleHeld.mutate({ id: view.id, body: { deduction, memo: memoValue } }, done('보류 정산을 요청했습니다.'));
      case 'prepay':
        if (prepayAmount === null || memoValue === null) return;
        return prepay.mutate(
          { id: view.id, body: { amount: prepayAmount, refundMode, memo: memoValue } },
          done('선환불을 요청했습니다.')
        );
      default: {
        const [target, how] = RESTART_TARGET[kind];
        return restart.mutate({ id: view.id, target, kind: how, body: restartBody() }, done('다시 요청했습니다.'));
      }
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{RETURN_ACTION_LABELS[kind]}</DialogTitle>
          <DialogDescription>{view.order.orderNo}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {kind === 'cancel' && <p>도착 전 반품을 취소합니다.</p>}

          {(kind === 'settleHeld' || kind === 'prepay') && (
            <PreviewLine
              loading={preview.isLoading}
              error={preview.isError}
              itemValue={preview.data?.itemValue}
              fee={
                preview.data
                  ? preview.data.feeEstimate.returnShipping +
                    preview.data.feeEstimate.freeShippingBreak +
                    preview.data.feeEstimate.roundTrip
                  : undefined
              }
            />
          )}

          {kind === 'settleHeld' && (
            <Field label="보류 차감액(원)">
              <Input inputMode="numeric" value={deductionText} onChange={(e) => setDeductionText(e.target.value)} />
            </Field>
          )}

          {kind === 'prepay' && (
            <>
              <Field label={itemValue !== undefined ? `선환불 금액(1 ~ ${formatWon(itemValue)})` : '선환불 금액(원)'}>
                <Input inputMode="numeric" value={prepayText} onChange={(e) => setAmountText(e.target.value)} />
              </Field>
              <RadioGroup value={refundMode} onValueChange={(v) => setRefundMode(v === 'manual' ? 'manual' : 'auto')} className="flex gap-4">
                <div className="flex items-center gap-2">
                  <RadioGroupItem id="rm-auto" value="auto" />
                  <Label htmlFor="rm-auto">자동 환불</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem id="rm-manual" value="manual" />
                  <Label htmlFor="rm-manual">계좌 송금</Label>
                </div>
              </RadioGroup>
            </>
          )}

          {(kind === 'closeMissing' || kind === 'settleHeld' || kind === 'prepay') && (
            <Field label="메모">
              <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={3} />
            </Field>
          )}

          {kind === 'retrySettlement' && action.needs === 'alreadyRefundedAmount' && (
            <Field label="이미 환불한 금액(원)">
              <Input inputMode="numeric" value={alreadyText} onChange={(e) => setAlreadyText(e.target.value)} />
              <p className="mt-1 text-xs text-muted-foreground">없으면 0</p>
            </Field>
          )}

          {kind === 'retrySettlement' && action.needs === 'dropHoldDeduction' && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={dropConfirmed} onChange={(e) => setDropConfirmed(e.target.checked)} />
              보류 차감을 빼고 정산합니다
            </label>
          )}

          {(kind === 'manualSettlement' || kind === 'manualPrepayment') && <p>계좌로 직접 송금하는 건으로 바꿉니다.</p>}
          {(kind === 'retryPrepayment' || (kind === 'retrySettlement' && !action.needs)) && <p>같은 조건으로 다시 요청합니다.</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            닫기
          </Button>
          <Button disabled={!ready || pending} onClick={submit}>
            {RETURN_ACTION_LABELS[kind]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function PreviewLine(props: { loading: boolean; error: boolean; itemValue?: number; fee?: number }) {
  if (props.loading) return <p className="text-muted-foreground">금액을 불러오는 중</p>;
  if (props.error || props.itemValue === undefined) return <p className="text-red-600">금액을 불러오지 못했습니다.</p>;
  return (
    <p className="text-muted-foreground">
      품목 값 {formatWon(props.itemValue)}
      {props.fee !== undefined ? ` · 택배비 예상 ${formatWon(props.fee)}` : ''}
    </p>
  );
}
