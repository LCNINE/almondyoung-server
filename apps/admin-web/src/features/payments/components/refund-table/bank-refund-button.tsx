'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { usePermissionCheck } from '@/hooks/use-permission';
import { TOSS_BANKS } from '@/lib/constants/toss-banks';
import { useExecuteBankRefund, walletQueryKeys } from '@/lib/services/wallet';
import type { RefundDto } from '@/lib/types/dto/wallet';
import { RefundConfirmCell } from './confirm-cell';
import {
  canExecuteBankRefund,
  isPendingBankRefund,
  listBankRefunds,
} from './bank-refund';

export function BankRefundForm({
  intentId,
  refund,
  excludedRefundIds = [],
  savedAccount,
  cancelled = false,
  onClose,
}: {
  intentId: string;
  refund?: RefundDto;
  excludedRefundIds?: string[];
  savedAccount?: RefundDto['refundReceiveAccount'];
  cancelled?: boolean;
  onClose: () => void;
}) {
  const id = useId();
  const [bank, setBank] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [holderName, setHolderName] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [looking, setLooking] = useState(false);
  const [resolvedRefund, setResolvedRefund] = useState<RefundDto>();
  const dirty = useRef(false);
  const active = useRef(true);
  const execute = useExecuteBankRefund();
  const { can } = usePermissionCheck();
  const query = { intentId, status: 'PENDING' };
  const refunds = useQuery({
    queryKey: [...walletQueryKeys.refundList(query), 'bank-account'],
    queryFn: () => listBankRefunds(query),
    enabled: !refund && can(['payment.refund.read']),
    retry: false,
    refetchInterval: (query) =>
      !refund && query.state.dataUpdateCount + query.state.errorUpdateCount < 5
        ? 1500
        : false,
  });
  const target =
    resolvedRefund ??
    refund ??
    refunds.data?.find(
      (item) =>
        isPendingBankRefund(item) && !excludedRefundIds.includes(item.id)
    );
  const saved = target?.refundReceiveAccount ?? savedAccount;
  const busy = looking || execute.isPending;
  const ready =
    TOSS_BANKS.some((b) => b.code === bank) &&
    /^\d{1,20}$/.test(accountNumber) &&
    !!holderName.trim() &&
    !holderName.includes('*');

  useEffect(() => {
    active.current = true;

    return () => {
      active.current = false;
    };
  }, []);

  useEffect(() => {
    if (dirty.current) return;

    setBank(saved?.bank ?? '');
    setAccountNumber(
      saved && /^\d{1,20}$/.test(saved.accountNumber) ? saved.accountNumber : ''
    );
    setHolderName(
      saved && !saved.holderName.includes('*') ? saved.holderName : ''
    );
  }, [saved]);

  const submit = async () => {
    if (!ready || busy) return;

    setLooking(true);

    try {
      let current = target;

      for (let attempt = 0; !current && attempt < 5; attempt += 1) {
        if (attempt > 0)
          await new Promise((resolve) => setTimeout(resolve, 1500));
        if (!active.current) return;

        const candidates = await listBankRefunds(query);

        current = candidates.find(
          (item) =>
            isPendingBankRefund(item) && !excludedRefundIds.includes(item.id)
        );
      }

      if (!active.current) return;
      if (!current) {
        toast.info(
          '환불을 준비하고 있어요. 잠시 뒤 주문내역에서 다시 눌러 주세요.'
        );
        onClose();

        return;
      }

      setResolvedRefund(current);
      const executing = current;

      execute.mutate(
        {
          refundId: current.id,
          intentId,
          account: { bank, accountNumber, holderName: holderName.trim() },
        },
        {
          onSuccess: (result) => {
            setResolvedRefund({
              ...executing,
              ...result,
              paymentMethodType: executing.paymentMethodType,
            });

            if (result.status === 'SUCCEEDED') {
              toast.success('계좌 환불이 완료되었습니다.');
              onClose();
            } else if (result.rejectedCode) {
              toast.error(
                result.status === 'PENDING'
                  ? `토스가 환불을 거절했어요(${result.rejectedCode}). 계좌 정보를 확인하고 다시 시도해 주세요.`
                  : `환불이 거절되었습니다: ${result.rejectedCode}`
              );
            } else if (result.status === 'PENDING') {
              toast.error(
                '자동 송금할 수 없는 결제입니다. 수동 송금 후 완료 처리해 주세요.'
              );
            } else {
              toast.error(
                result.failureCode === 'PROVIDER_EXCEPTION'
                  ? '송금 결과를 확인하지 못했습니다. 같은 계좌로 다시 확인해 주세요. 직접 송금하지 마세요.'
                  : `환불이 거절되었습니다: ${result.failureCode ?? 'UNKNOWN'}`
              );
            }
          },
          onError: () => {
            setUncertain(true);
            toast.error(
              '환불 결과를 확인하지 못했습니다. 새로고침 후 환불 상태를 확인해 주세요.'
            );
          },
        }
      );
    } catch {
      toast.error(
        '환불 내역을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.'
      );
    } finally {
      setLooking(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {cancelled ? '주문을 취소했어요' : '계좌로 환불'}
        </DialogTitle>
        <DialogDescription>
          {target
            ? cancelled
              ? `무통장 결제라 ${target.amount.toLocaleString('ko-KR')}원을 돌려줄 계좌가 필요해요.`
              : `${target.amount.toLocaleString('ko-KR')}원을 입력한 계좌로 환불해요.`
            : '무통장 결제라 돌려줄 계좌가 필요해요. 환불 금액을 확인하고 있어요.'}
        </DialogDescription>
      </DialogHeader>
      {saved && (
        <p className="text-sm text-gray-500">
          고객이 남긴 환불 계좌를 미리 채웠어요. 가려진 정보는 다시 입력해
          주세요.
        </p>
      )}
      {target?.failureCode === 'PROVIDER_EXCEPTION' && (
        <p className="text-sm text-amber-700">
          이전 요청과 같은 계좌를 입력하세요. 송금 결과가 확인될 때까지 직접
          송금하지 마세요.
        </p>
      )}
      {refunds.isError && (
        <p role="alert">환불 내역을 불러오지 못했습니다. 다시 시도해 주세요.</p>
      )}
      <div className="space-y-2">
        <Label htmlFor={`${id}-bank`}>환불 은행</Label>
        <select
          id={`${id}-bank`}
          className="w-full border rounded p-2 text-sm"
          value={bank}
          onChange={(e) => {
            dirty.current = true;
            setBank(e.target.value);
          }}
          disabled={busy}
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
        <Label htmlFor={`${id}-account`}>환불 계좌번호</Label>
        <Input
          id={`${id}-account`}
          value={accountNumber}
          inputMode="numeric"
          maxLength={20}
          disabled={busy}
          onChange={(e) => {
            dirty.current = true;
            setAccountNumber(e.target.value.replace(/[\s-]/g, ''));
          }}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-holder`}>예금주명</Label>
        <Input
          id={`${id}-holder`}
          value={holderName}
          maxLength={100}
          disabled={busy}
          onChange={(e) => {
            dirty.current = true;
            setHolderName(e.target.value);
          }}
        />
      </div>
      <DialogFooter className="sm:justify-between">
        {!target && (
          <Button variant="link" className="text-gray-500 underline" disabled>
            직접 송금했어요
          </Button>
        )}
        {target?.manualConfirmable && !busy && !uncertain && (
          <RefundConfirmCell
            refund={target}
            label="직접 송금했어요"
            onConfirmed={onClose}
          />
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            닫기
          </Button>
          <Can run={useExecuteBankRefund}>
            <Button
              className="bg-blue-600 text-white hover:bg-blue-700"
              onClick={submit}
              disabled={
                !ready || busy || (!!target && !canExecuteBankRefund(target))
              }
            >
              {busy ? '처리 중...' : '계좌로 환불'}
            </Button>
          </Can>
        </div>
      </DialogFooter>
    </>
  );
}

export function BankRefundButton({
  refund,
  primary = false,
}: {
  refund: RefundDto;
  primary?: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!canExecuteBankRefund(refund)) return null;

  return (
    <Can run={useExecuteBankRefund}>
      <Button
        size="sm"
        variant={primary ? 'default' : 'outline'}
        className={
          primary
            ? 'w-full bg-blue-600 text-white hover:bg-blue-700'
            : 'h-7 text-xs'
        }
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        계좌로 환불
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          {open && (
            <BankRefundForm
              refund={refund}
              intentId={refund.intentId}
              onClose={() => setOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Can>
  );
}
