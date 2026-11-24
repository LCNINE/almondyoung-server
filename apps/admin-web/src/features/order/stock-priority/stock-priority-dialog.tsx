'use client';

import { useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { OperationReasonFields } from '@/features/order/fulfillments/detail/operation-reason-fields';
import {
  canSubmitOperationReason,
  toOperationReasonPayload,
  type OperationReasonValue,
} from '@/features/order/fulfillments/detail/operation-reasons';
import { parseServerError } from '@/lib/api/server-error';
import {
  useCancelStockPriority,
  useSetStockPriority,
} from '@/lib/services/orders/mutations';
import { useStockPriorityPreview } from '@/lib/services/orders/queries';
import type {
  SetStockPriorityRequest,
  ShipmentCommandReason,
  StockPriorityHeld,
  StockPriorityPlan,
  StockPriorityPreview,
} from '@/lib/types/dto/fulfillment';
import {
  heldText,
  isPlanChanged,
  PLAN_CHANGED_TEXT,
  planOutcomeText,
  resultText,
  stockPriorityBlockedText,
  stockPriorityErrorText,
  takeOutcomeText,
} from './stock-priority-copy';

const NO_ANSWER =
  '응답을 받지 못했어요. «같은 요청 다시 보내기»를 누르면 한 번만 처리돼요.';

const DEFAULT_REASON: OperationReasonValue = {
  reasonCode: 'blocked_by_waiting_order',
  otherText: '',
  note: '',
};

type Target = { shipmentId: string; orderText: string };

/** 다른 대기 주문이 잡은 재고를 이 상자로 옮기고, 다음 재고도 먼저 받게 한다. */
export function StockPriorityDialog({
  shipmentId,
  orderText,
  onClose,
}: Target & { onClose: () => void }) {
  const preview = useStockPriorityPreview(shipmentId);
  const prioritize = useSetStockPriority();
  const [includeReady, setIncludeReady] = useState(false);
  const [reason, setReason] = useState(DEFAULT_REASON);
  const [showErrors, setShowErrors] = useState(false);
  const [changed, setChanged] = useState(false);
  // 응답을 못 받은 요청 — 같은 키·같은 내용으로 다시 보내야 두 번 처리되지 않는다
  const [unanswered, setUnanswered] = useState<{
    data: SetStockPriorityRequest;
    idempotencyKey: string;
  } | null>(null);
  const data = preview.data;
  const plan =
    (includeReady ? data?.planWithReady : null) ?? data?.plan ?? null;
  const usesReady = includeReady && !!data?.planWithReady;
  const busy = prioritize.isPending;

  const send = async (request: {
    data: SetStockPriorityRequest;
    idempotencyKey: string;
  }) => {
    try {
      const result = await prioritize.mutateAsync({ shipmentId, ...request });
      toast.success(resultText(orderText, result));
      onClose();
    } catch (error) {
      const { status } = parseServerError(error);
      if (status === null || status >= 500) {
        setUnanswered(request);
        return;
      }
      setUnanswered(null);
      if (isPlanChanged(error)) {
        setChanged(true);
        setIncludeReady(false);
      } else {
        toast.error(stockPriorityErrorText(error));
      }
      void preview.refetch();
    }
  };

  const submit = () => {
    if (!plan) return;
    if (!canSubmitOperationReason('stock_priority', reason)) {
      setShowErrors(true);
      return;
    }
    void send({
      data: {
        ...toOperationReasonPayload('stock_priority', reason),
        planToken: plan.token,
        ...(usesReady ? { includeReady: true } : {}),
      },
      idempotencyKey: crypto.randomUUID(),
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{orderText} 우선할당</DialogTitle>
          <DialogDescription className="break-keep">
            이 주문이 다른 대기 주문보다 재고를 먼저 받아요. 지금 다른 대기
            주문이 잡아 둔 재고도 이 주문으로 옮겨요. 우선할당한 주문끼리는 먼저
            주문한 순서예요.
          </DialogDescription>
        </DialogHeader>
        {changed && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {PLAN_CHANGED_TEXT}
          </p>
        )}
        {preview.isPending ? (
          <p className="text-sm text-muted-foreground">재고를 확인하는 중…</p>
        ) : !data ? (
          <div role="alert" className="flex items-center gap-2 text-sm">
            <span>재고를 확인하지 못했어요.</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void preview.refetch()}
            >
              다시 시도
            </Button>
          </div>
        ) : data.blocked ? (
          <p className="break-keep text-sm">
            {stockPriorityBlockedText(data.blocked)}
          </p>
        ) : (
          plan && (
            <div className="space-y-4">
              <MissingLines lines={data.lines} />
              <PlanSummary plan={plan} held={data.held ?? []} />
              {data.planWithReady && (
                <ReadyChoice
                  checked={includeReady}
                  disabled={busy || !!unanswered}
                  missingQty={data.plan?.missingQty ?? 0}
                  onChange={setIncludeReady}
                />
              )}
              {!unanswered && (
                <OperationReasonFields
                  type="stock_priority"
                  value={reason}
                  onChange={setReason}
                  showErrors={showErrors}
                />
              )}
            </div>
          )
        )}
        {unanswered && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {NO_ANSWER}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            닫기
          </Button>
          {unanswered ? (
            <Button
              type="button"
              disabled={busy}
              onClick={() => void send(unanswered)}
            >
              같은 요청 다시 보내기
            </Button>
          ) : (
            <Button
              type="button"
              disabled={busy || preview.isFetching || !plan || !!data?.blocked}
              onClick={submit}
            >
              우선할당
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MissingLines({ lines }: { lines: StockPriorityPreview['lines'] }) {
  return (
    <ul role="list" aria-label="이 상자의 상품" className="space-y-1 text-sm">
      {lines.map((line, index) => (
        <li key={index}>
          <span className="font-medium">{line.skuName}</span>{' '}
          <span className="tabular-nums text-muted-foreground">
            주문 {line.qty} · 잡은 재고 {line.reservedQty}
            {line.missingQty > 0 ? ` · 모자람 ${line.missingQty}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PlanSummary({
  plan,
  held,
}: {
  plan: StockPriorityPlan;
  held: StockPriorityHeld[];
}) {
  return (
    <div className="space-y-2 rounded-md border p-3 text-sm">
      {plan.freeQty > 0 && (
        <p className="tabular-nums">남는 재고에서 {plan.freeQty}개를 잡아요.</p>
      )}
      {plan.takes.length > 0 && (
        <ul role="list" aria-label="재고를 내줄 주문" className="space-y-1.5">
          {plan.takes.map((take, index) => (
            <li key={index} className="break-keep">
              <span className="block font-medium tabular-nums">
                {take.orderNos.length > 0
                  ? take.orderNos.map((no) => `#${no}`).join(', ')
                  : '주문번호 없는 상자'}
                에서 {take.skuName} {take.qty}개
              </span>
              <span
                className={
                  take.ready
                    ? 'block font-medium text-destructive'
                    : 'block text-muted-foreground'
                }
              >
                {takeOutcomeText(take)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="break-keep font-semibold">{planOutcomeText(plan)}</p>
      {plan.missingQty > 0 &&
        held.map((row) => (
          <p key={row.reason} className="break-keep text-muted-foreground">
            {heldText(row)}
          </p>
        ))}
    </div>
  );
}

function ReadyChoice({
  checked,
  disabled,
  missingQty,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  missingQty: number;
  onChange: (next: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(next === true)}
      />
      <Label htmlFor={id} className="break-keep font-normal leading-normal">
        바로 나갈 수 있는 주문의 재고도 가져오기 — 모자란 {missingQty}개까지 다
        채우는 대신 그 주문이 못 나가요
      </Label>
    </div>
  );
}

/** 우선할당 표시만 거둔다. 이미 잡은 재고는 그대로 둔다. */
export function StockPriorityCancelDialog({
  shipmentId,
  orderText,
  onClose,
}: Target & { onClose: () => void }) {
  const cancel = useCancelStockPriority();
  const [reason, setReason] = useState<OperationReasonValue>({
    reasonCode: 'no_longer_urgent',
    otherText: '',
    note: '',
  });
  const [showErrors, setShowErrors] = useState(false);
  const [unanswered, setUnanswered] = useState<{
    data: ShipmentCommandReason;
    idempotencyKey: string;
  } | null>(null);

  const send = async (request: {
    data: ShipmentCommandReason;
    idempotencyKey: string;
  }) => {
    try {
      await cancel.mutateAsync({ shipmentId, ...request });
      toast.success(`${orderText} 우선할당을 취소했어요.`);
      onClose();
    } catch (error) {
      const { status } = parseServerError(error);
      if (status === null || status >= 500) {
        setUnanswered(request);
        return;
      }
      setUnanswered(null);
      toast.error('우선할당을 취소하지 못했어요. 새로고침해 확인해 주세요.');
    }
  };

  const submit = () => {
    if (unanswered) {
      void send(unanswered);
      return;
    }
    if (!canSubmitOperationReason('stock_priority_cancel', reason)) {
      setShowErrors(true);
      return;
    }
    void send({
      data: toOperationReasonPayload('stock_priority_cancel', reason),
      idempotencyKey: crypto.randomUUID(),
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !cancel.isPending && onClose()}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{orderText} 우선할당 취소</DialogTitle>
          <DialogDescription className="break-keep">
            다음 재고부터 원래 순서로 받아요. 이미 잡은 재고는 그대로 둬요.
          </DialogDescription>
        </DialogHeader>
        {!unanswered && (
          <OperationReasonFields
            type="stock_priority_cancel"
            value={reason}
            onChange={setReason}
            showErrors={showErrors}
          />
        )}
        {unanswered && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {NO_ANSWER}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={cancel.isPending}
            onClick={onClose}
          >
            닫기
          </Button>
          <Button type="button" disabled={cancel.isPending} onClick={submit}>
            {unanswered ? '같은 요청 다시 보내기' : '우선할당 취소'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
