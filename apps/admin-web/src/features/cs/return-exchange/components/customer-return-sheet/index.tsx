'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Can } from '@/components/auth/can';
import {
  useCancelCustomerReturn,
  useCloseCustomerReturnMissing,
  useCustomerReturn,
  useRequestCustomerReturnPrepay,
  useRestartCustomerReturn,
  useSettleHeldCustomerReturn,
} from '@/lib/services/customer-returns';
import type { CustomerReturnView } from '@/lib/types/dto/customer-returns';
import { availableCustomerReturnActions, type CustomerReturnAction } from '../../customer-return-actions';
import {
  RETURN_ACTION_LABELS,
  RETURN_FEE_BEARER_LABELS,
  RETURN_REASON_LABELS,
  RETURN_STATUS_LABELS,
} from '../../customer-return-labels';
import { formatKstDate, formatKstDateTime, formatWon } from '../format';
import { CustomerReturnActionDialog } from '../customer-return-action-dialog';

/** 버튼 종류별로 그 동작의 훅이 선언한 권한으로 가린다 (mutation-guard 게이트가 `run={useX}` 를 본다) */
function Gated({ kind, children }: { kind: CustomerReturnAction['kind']; children: React.ReactNode }) {
  switch (kind) {
    case 'cancel':
      return <Can run={useCancelCustomerReturn}>{children}</Can>;
    case 'closeMissing':
      return <Can run={useCloseCustomerReturnMissing}>{children}</Can>;
    case 'settleHeld':
      return <Can run={useSettleHeldCustomerReturn}>{children}</Can>;
    case 'prepay':
      return <Can run={useRequestCustomerReturnPrepay}>{children}</Can>;
    case 'retrySettlement':
    case 'manualSettlement':
    case 'retryPrepayment':
    case 'manualPrepayment':
      return <Can run={useRestartCustomerReturn}>{children}</Can>;
  }
}

const SUB_STATE_LABELS = {
  in_progress: '진행 중',
  refused: '거절됨',
  stalled: '멈춤',
  done: '완료',
  superseded: '대체됨',
} as const;

const DEDUCTION_LABELS = [
  ['returnShipping', '반품 택배비'],
  ['freeShippingBreak', '무료배송 해제분'],
  ['roundTrip', '왕복 택배비'],
  ['hold', '보류 차감'],
] as const;

interface Props {
  id: string | null;
  /** 목록 행의 고객명 — 상세에는 개인정보가 없다 */
  customerName: string | null;
  onClose: () => void;
}

export function CustomerReturnSheet({ id, customerName, onClose }: Props) {
  const { data: view, isLoading, isError } = useCustomerReturn(id);
  const [action, setAction] = useState<CustomerReturnAction | null>(null);

  return (
    <Sheet open={!!id} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>반품 상세</SheetTitle>
          <SheetDescription className="sr-only">반품 기록과 CS 처리</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4 pb-6 text-sm">
          {isLoading && <p className="text-muted-foreground">불러오는 중</p>}
          {isError && <p className="text-red-600">반품을 불러오지 못했습니다.</p>}
          {view && <Body view={view} customerName={customerName} onAction={setAction} />}
        </div>
        {view && action && (
          <CustomerReturnActionDialog
            view={view}
            action={action}
            onClose={() => setAction(null)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Body({
  view,
  customerName,
  onAction,
}: {
  view: CustomerReturnView;
  customerName: string | null;
  onAction: (a: CustomerReturnAction) => void;
}) {
  const actions = availableCustomerReturnActions(view);
  const { settlement, settlementOutcome, prepayment, csResolution } = view;
  const failure =
    settlement && (settlement.state === 'refused' || settlement.state === 'stalled')
      ? settlement.lastFailure
      : prepayment && (prepayment.state === 'refused' || prepayment.state === 'stalled')
        ? prepayment.lastFailure
        : null;

  return (
    <>
      <section className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            className="font-medium underline"
            href={`/order/history?orderNo=${encodeURIComponent(view.order.orderNo)}`}
          >
            {view.order.orderNo}
          </Link>
          <Badge variant="secondary">{RETURN_STATUS_LABELS[view.status]}</Badge>
        </div>
        {customerName && <div>{customerName}</div>}
        <div>
          {RETURN_REASON_LABELS[view.reason as keyof typeof RETURN_REASON_LABELS] ?? view.reason}
          {' · '}배송비 부담 {RETURN_FEE_BEARER_LABELS[view.feeBearer as 'customer' | 'seller'] ?? view.feeBearer}
          {' · '}요청 {view.requestedBy === 'customer' ? '고객' : 'CS'} ({formatKstDateTime(view.requestedAt)})
        </div>
        {view.arrivedAt && (
          <div>
            도착 {formatKstDate(view.arrivedAt)} · 환불 기한 {formatKstDate(view.refundDueAt)}
          </div>
        )}
        {view.windowOverrideReason && <div>기한 넘김 사유: {view.windowOverrideReason}</div>}
      </section>

      <section>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>품목 / SKU</TableHead>
              <TableHead className="text-right">수량</TableHead>
              <TableHead className="text-right">기대 · 도착</TableHead>
              <TableHead className="text-right">양품 · 불량 · 보류</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.lines.map((line) => (
              <LineRows key={line.id} line={line} />
            ))}
          </TableBody>
        </Table>
      </section>

      {(settlementOutcome || prepayment || csResolution) && (
        <section className="space-y-1">
          {settlementOutcome && (
            <div className="space-y-0.5">
              <div className="font-medium">환불 {formatWon(settlementOutcome.refundAmount)}</div>
              {DEDUCTION_LABELS.map(([key, label]) => {
                const amount = settlementOutcome.deduction[key];
                return amount ? (
                  <div key={key} className="text-muted-foreground">
                    {label} -{formatWon(amount)}
                  </div>
                ) : null;
              })}
              {settlementOutcome.feeNotAdjusted && <div className="text-red-600">택배비 미조정</div>}
            </div>
          )}
          {prepayment && (
            <div>
              선환불{' '}
              {formatWon(prepayment.outcome?.amount ?? prepayment.requestedAmount ?? 0)} ·{' '}
              {SUB_STATE_LABELS[prepayment.state]}
            </div>
          )}
          {csResolution?.hold && (
            <div>
              보류 차감 {formatWon(csResolution.hold.deduction)} · {csResolution.hold.memo}
              {csResolution.hold.dropped && ' · 차감 뺌'}
            </div>
          )}
          {csResolution?.missing && <div>미도착 닫음 · {csResolution.missing.memo}</div>}
        </section>
      )}

      {failure && <p className="rounded border border-red-200 bg-red-50 p-2 text-red-700">{failure.message}</p>}

      {actions.length > 0 && (
        <section className="flex flex-wrap gap-2 border-t pt-4">
          {actions.map((a) => (
            <Gated key={a.kind} kind={a.kind}>
              <Button size="sm" variant="outline" onClick={() => onAction(a)}>
                {RETURN_ACTION_LABELS[a.kind]}
              </Button>
            </Gated>
          ))}
        </section>
      )}
    </>
  );
}

function LineRows({ line }: { line: CustomerReturnView['lines'][number] }) {
  return (
    <>
      <TableRow>
        <TableCell className="font-medium">{line.productName}</TableCell>
        <TableCell className="text-right">
          {line.quantity}
          {line.missingQty > 0 && <span className="ml-1 text-red-600">미도착 {line.missingQty}</span>}
        </TableCell>
        <TableCell />
        <TableCell />
      </TableRow>
      {line.items.map((it) => (
        <TableRow key={it.id}>
          <TableCell className="pl-6 text-muted-foreground">
            {it.skuName} <span className="text-xs">{it.skuCode}</span>
          </TableCell>
          <TableCell />
          <TableCell className="text-right">
            {it.expectedQty} · {it.arrivedQty}
          </TableCell>
          <TableCell className="text-right">
            {it.acceptedQty ?? '-'} · {it.rejectedQty ?? '-'} · {it.heldQty ?? '-'}
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}
