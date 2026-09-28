'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, ChevronDown, CircleCheck, History } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils/ui';
import { formatDate, formatDateTime } from '@/lib/utils/date';
import {
  useAdjustArrearsAmount,
  useMemberArrears,
  useWaiveArrears,
} from '@/lib/services/membership';
import type {
  ArrearsAdjustmentItem,
  ArrearsItem,
  ArrearsLineBenefit,
  ArrearsTimelineEvent,
} from '@/lib/api/domains/membership/people';
import {
  adminErrorMessage,
  ARREARS_STATUS_LABEL,
  arrearsCauseLabel,
  daysSince,
  periodLabel,
  won,
} from '../people/format';

type Action = { kind: 'waive' | 'adjust'; item: ArrearsItem } | null;

const SKIP_REASON: Record<string, string> = {
  TERMS_NOT_IN_FORCE:
    '새 약관(미납 요금 조항)에 동의하기 전 계약이라 미납으로 남기지 않았습니다',
  WITHDRAWAL_ELIGIBLE:
    '이용 7일 안이고 혜택을 쓰지 않아 미납으로 남기지 않았습니다',
};

const MISMATCH_REASON: Record<string, string> = {
  UNDERPAID: '청구보다 적게 들어왔습니다',
  OVERPAID: '청구보다 많이 들어왔습니다',
  NO_OPEN_ARREARS: '이미 닫힌 미납에 돈이 들어왔습니다',
};

const meta = (e: ArrearsTimelineEvent, key: string) => e.metadata[key];
const metaStr = (e: ArrearsTimelineEvent, key: string): string => {
  const v = meta(e, key);
  return typeof v === 'string' ? v : '';
};
const metaNum = (e: ArrearsTimelineEvent, key: string) => {
  const v = meta(e, key);
  return typeof v === 'number' ? v : Number(v ?? NaN);
};

/** 사건 한 건을 관리자가 읽는 문장으로. needsAttention 이면 사람이 확인해야 하는 일이다. */
function describeEvent(e: ArrearsTimelineEvent): {
  text: string;
  needsAttention: boolean;
} {
  switch (e.eventType) {
    case 'ARREARS_RECORDED': {
      const amount = metaNum(e, 'amount');
      return {
        text: `미납 요금이 생겼습니다${Number.isFinite(amount) ? ` (${won(amount)})` : ''} — ${arrearsCauseLabel(metaStr(e, 'cause'))}`,
        needsAttention: false,
      };
    }
    case 'ARREARS_SKIPPED':
      return {
        text: SKIP_REASON[metaStr(e, 'reason')] ?? '미납으로 남기지 않았습니다',
        needsAttention: false,
      };
    case 'ARREARS_SETTLEMENT_MISMATCH': {
      const paid = metaNum(e, 'paid');
      const due = metaNum(e, 'due');
      const amounts =
        Number.isFinite(paid) && Number.isFinite(due)
          ? ` (들어온 돈 ${won(paid)} · 청구 ${won(due)})`
          : '';
      return {
        text: `납부 금액이 맞지 않습니다 — ${MISMATCH_REASON[metaStr(e, 'reason')] ?? '확인이 필요합니다'}${amounts}. 결제관리에서 환불이나 조정이 필요한지 확인하세요.`,
        needsAttention: true,
      };
    }
    case 'INVOICE_ADVANCE_GRANT_WITHHELD':
      return {
        text: '미납 요금이 있어 다음 주기 혜택을 결제 확인 전에 미리 열어 주지 않았습니다',
        needsAttention: false,
      };
    default:
      return { text: e.eventType, needsAttention: false };
  }
}

function adjustmentText(a: ArrearsAdjustmentItem): string {
  if (a.action === 'WAIVE') return `${won(a.amountBefore)} 면제`;
  return `${won(a.amountBefore)} → ${won(a.amountAfter)}로 조정`;
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'OUTSTANDING')
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="size-3" aria-hidden />
        {ARREARS_STATUS_LABEL[status]}
      </Badge>
    );
  if (status === 'SETTLED')
    return (
      <Badge variant="secondary" className="gap-1">
        <CircleCheck className="size-3" aria-hidden />
        {ARREARS_STATUS_LABEL[status]}
      </Badge>
    );
  return (
    <Badge variant="outline">{ARREARS_STATUS_LABEL[status] ?? status}</Badge>
  );
}

function LineCard({
  item,
  benefit,
  adjustments,
  mismatches,
  allowActions,
  onAction,
}: {
  item: ArrearsItem;
  benefit?: ArrearsLineBenefit;
  adjustments: ArrearsAdjustmentItem[];
  mismatches: ArrearsTimelineEvent[];
  allowActions: boolean;
  onAction: (action: Action) => void;
}) {
  const outstanding = item.status === 'OUTSTANDING';
  const period = periodLabel(item.periodStart, item.periodEnd);
  return (
    <Card
      className={cn(
        'gap-0 border py-0 shadow-none',
        outstanding ? 'border-red-200' : 'border-gray-200'
      )}
    >
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-gray-900">
              {period ?? '청구 기간 미상'}
            </p>
            {item.periodStart && item.periodEnd && period?.endsWith('분') && (
              <p className="text-xs text-gray-500">
                {formatDate(item.periodStart)} ~ {formatDate(item.periodEnd)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'text-base font-bold tabular-nums',
                outstanding ? 'text-gray-900' : 'text-gray-400 line-through'
              )}
            >
              {won(item.amount)}
            </span>
            <StatusBadge status={item.status} />
          </div>
        </div>

        <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-gray-500">생긴 이유</dt>
          <dd className="text-gray-900">
            {arrearsCauseLabel(item.cause, item.causeCode)}
          </dd>
          <dt className="text-gray-500">생긴 날</dt>
          <dd className="text-gray-900">
            {formatDate(item.createdAt)}
            {outstanding && (
              <span className="ml-1 text-gray-500">
                ({daysSince(item.createdAt)}일째)
              </span>
            )}
          </dd>
          <dt className="text-gray-500">그 기간 혜택</dt>
          <dd className="text-gray-900">
            {!benefit || !benefit.measurable ? (
              <span className="text-gray-500">청구 기간을 몰라 셀 수 없음</span>
            ) : (
              <>
                {benefit.discountAmount > 0
                  ? `할인 ${won(benefit.discountAmount)} (${benefit.discountOrders}건)`
                  : '할인 없음'}
                {benefit.welcomeDeal && (
                  <span className="ml-1 text-amber-700">· 웰컴딜 구매</span>
                )}
              </>
            )}
          </dd>
          {item.amountSource === 'PLAN_FALLBACK' && (
            <>
              <dt className="text-gray-500">금액 근거</dt>
              <dd className="text-amber-700">
                청구서가 없어 현재 플랜 가격으로 적은 금액입니다 — 실제 청구액과
                다를 수 있습니다
              </dd>
            </>
          )}
          {item.status === 'SETTLED' && item.settledAt && (
            <>
              <dt className="text-gray-500">받은 날</dt>
              <dd className="text-gray-900">
                {formatDate(item.settledAt)} · 고객 납부
              </dd>
            </>
          )}
          {item.status === 'WAIVED' && (
            <>
              <dt className="text-gray-500">면제</dt>
              <dd className="text-gray-900">
                {item.settledAt ? formatDate(item.settledAt) : '-'} ·{' '}
                {item.settlementRef ?? '사유 없음'}
              </dd>
            </>
          )}
        </dl>

        {mismatches.map((m) => (
          <p
            key={m.id}
            className="flex items-start gap-1.5 rounded-md bg-amber-50 p-2 text-xs text-amber-800"
          >
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
            {formatDateTime(m.createdAt)} · {describeEvent(m).text}
          </p>
        ))}

        {(adjustments.length > 0 || (outstanding && allowActions)) && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3">
            {adjustments.length > 0 ? (
              <Collapsible className="w-full">
                <CollapsibleTrigger className="group inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900">
                  <History className="size-3.5" aria-hidden />
                  사람이 손댄 기록 {adjustments.length}건
                  <ChevronDown
                    className="size-3.5 transition-transform group-data-[state=open]:rotate-180"
                    aria-hidden
                  />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ol className="mt-2 space-y-1.5">
                    {adjustments.map((a) => (
                      <li
                        key={a.id}
                        className="rounded-md bg-gray-50 p-2 text-xs text-gray-700"
                      >
                        <span className="font-medium text-gray-900">
                          {adjustmentText(a)}
                        </span>
                        <span className="ml-1 text-gray-500">
                          · {formatDateTime(a.createdAt)}
                        </span>
                        <span className="block">사유: {a.reason}</span>
                        <span className="block font-mono text-[11px] text-gray-400">
                          처리자 {a.adminId}
                        </span>
                      </li>
                    ))}
                  </ol>
                </CollapsibleContent>
              </Collapsible>
            ) : (
              <span />
            )}
            {outstanding && allowActions && (
              <div className="ml-auto flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={() => onAction({ kind: 'adjust', item })}
                >
                  금액 조정
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-red-600 hover:text-red-700"
                  onClick={() => onAction({ kind: 'waive', item })}
                >
                  면제
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActionDialog({
  userId,
  action,
  onClose,
}: {
  userId: string;
  action: Action;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const waive = useWaiveArrears(userId);
  const adjust = useAdjustArrearsAmount(userId);
  const pending = waive.isPending || adjust.isPending;

  if (!action) return null;
  const { item, kind } = action;
  // 기간을 모르면 문장에서 뺀다 — 「청구 기간 미상 10,000원을 면제」처럼 읽히지 않게.
  const period = periodLabel(item.periodStart, item.periodEnd);
  const target = period ? `${period} ` : '';
  const nextAmount = Number(amount);
  const amountValid =
    Number.isInteger(nextAmount) &&
    nextAmount > 0 &&
    nextAmount !== item.amount;
  const canSubmit =
    reason.trim().length > 0 && (kind === 'waive' || amountValid) && !pending;

  const close = () => {
    setReason('');
    setAmount('');
    onClose();
  };

  const submit = async () => {
    try {
      if (kind === 'waive') {
        await waive.mutateAsync({ arrearsId: item.id, reason: reason.trim() });
        toast.success(`${target}${won(item.amount)}을 면제했습니다.`);
      } else {
        await adjust.mutateAsync({
          arrearsId: item.id,
          amount: nextAmount,
          reason: reason.trim(),
        });
        toast.success(
          `${target}미납 요금을 ${won(nextAmount)}으로 조정했습니다.`
        );
      }
      close();
    } catch (error) {
      toast.error(
        adminErrorMessage(
          error,
          kind === 'waive'
            ? '면제하지 못했습니다.'
            : '금액을 조정하지 못했습니다.'
        )
      );
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {kind === 'waive' ? '미납 요금 면제' : '미납 요금 금액 조정'}
          </DialogTitle>
          <DialogDescription>
            {kind === 'waive'
              ? `${target}${won(item.amount)}을 받지 않기로 합니다. 되돌릴 수 없고, 이 고객은 남은 미납이 없으면 바로 다시 가입할 수 있습니다.`
              : `${target}미납 요금을 고칩니다. 지금 ${won(item.amount)}입니다. 전액을 없애려면 면제를 쓰세요.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {kind === 'adjust' && (
            <div className="space-y-1.5">
              <Label htmlFor="arrears-amount">
                새 금액(원) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="arrears-amount"
                name="arrearsAmount"
                autoComplete="off"
                type="number"
                inputMode="numeric"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={amount !== '' && !amountValid}
              />
              {amount !== '' && !amountValid && (
                <p className="text-xs text-destructive">
                  1원 이상이고 지금 금액과 다른 정수를 넣어 주세요.
                </p>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="arrears-reason">
              사유 <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="arrears-reason"
              name="arrearsReason"
              autoComplete="off"
              rows={3}
              placeholder={
                kind === 'waive'
                  ? '예: 은행 점검으로 출금이 실패한 것을 확인'
                  : '예: 계좌이체로 5,000원 입금 확인'
              }
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="text-xs text-gray-500">
              사유와 처리자는 기록으로 남고 지워지지 않습니다.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={pending}>
            닫기
          </Button>
          <Button
            variant={kind === 'waive' ? 'destructive' : 'default'}
            onClick={() => void submit()}
            disabled={!canSubmit}
          >
            {pending
              ? '처리 중…'
              : kind === 'waive'
                ? `${won(item.amount)} 면제`
                : '금액 조정'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 회원 상세 «미납 요금» 탭. 맨 위 한 문단이 상황을 말하고, 아래는 주기마다 카드 한 장.
 * 면제·조정은 남은 줄 카드 안에서만 연다. 드문 경고(납부 금액 불일치)는 해당 카드에 붙인다.
 */
export function ArrearsTab({
  userId,
  allowActions = true,
}: {
  userId: string;
  allowActions?: boolean;
}) {
  const { data, isLoading, isError } = useMemberArrears(userId);
  const [action, setAction] = useState<Action>(null);

  const view = useMemo(() => {
    if (!data) return null;
    const items = [...data.items].sort((a, b) => {
      if ((a.status === 'OUTSTANDING') !== (b.status === 'OUTSTANDING'))
        return a.status === 'OUTSTANDING' ? -1 : 1;
      return (b.periodStart ?? b.createdAt).localeCompare(
        a.periodStart ?? a.createdAt
      );
    });
    const events = data.events ?? [];
    const mismatches = events.filter(
      (e) => e.eventType === 'ARREARS_SETTLEMENT_MISMATCH'
    );
    // 한 줄만 가리키는 불일치는 그 카드에, 여러 줄(한 번에 낸 청산)이나 모르는 줄은 맨 위에 한 번만 —
    // 같은 사건을 카드마다 되풀이하면 불일치가 여러 건으로 읽힌다.
    const idsOf = (m: ArrearsTimelineEvent): unknown[] =>
      Array.isArray(m.metadata.arrearsIds)
        ? (m.metadata.arrearsIds as unknown[])
        : [];
    const singleLine = (m: ArrearsTimelineEvent) =>
      idsOf(m).length === 1 && items.some((i) => i.id === idsOf(m)[0]);
    const mismatchesFor = (id: string) =>
      mismatches.filter((m) => singleLine(m) && idsOf(m)[0] === id);
    const unattachedMismatches = mismatches.filter((m) => !singleLine(m));
    const outstanding = items.filter((i) => i.status === 'OUTSTANDING');
    const benefitsById = new Map(
      (data.benefits ?? []).map((b) => [b.arrearsId, b])
    );
    const outstandingDiscount = outstanding.reduce(
      (sum, i) => sum + (benefitsById.get(i.id)?.discountAmount ?? 0),
      0
    );
    return {
      items,
      events,
      mismatchesFor,
      unattachedMismatches,
      outstanding,
      benefitsById,
      outstandingDiscount,
    };
  }, [data]);

  if (isLoading) return <Skeleton className="h-48 w-full bg-gray-100" />;
  if (isError || !data || !view) {
    return (
      <p className="py-8 text-center text-sm text-gray-500">
        미납 요금 정보를 불러오지 못했습니다.
      </p>
    );
  }

  if (view.items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <CircleCheck className="size-6 text-emerald-500" aria-hidden />
        <p className="text-sm text-gray-700">미납 요금 기록이 없습니다.</p>
        <p className="text-xs text-gray-500">
          자동이체 출금이 끝내 실패하거나 계좌 심사가 거절되면 여기에 남습니다.
        </p>
      </div>
    );
  }

  const { outstanding } = view;
  const oldest = outstanding.reduce<ArrearsItem | null>(
    (o, i) => (!o || i.createdAt < o.createdAt ? i : o),
    null
  );
  const periods = [...outstanding]
    .sort((a, b) =>
      (a.periodStart ?? a.createdAt).localeCompare(b.periodStart ?? b.createdAt)
    )
    .map((i) => periodLabel(i.periodStart, i.periodEnd))
    .filter(Boolean);

  return (
    <div className="space-y-4">
      <Card
        className={cn(
          'gap-0 py-0 shadow-none',
          outstanding.length > 0
            ? 'border-red-200 bg-red-50/40'
            : 'border-gray-200'
        )}
      >
        <CardContent className="space-y-1.5 p-4">
          {outstanding.length > 0 ? (
            <>
              <p className="text-base font-semibold text-gray-900">
                미납 요금 {won(data.outstanding.total)}이 남아 있어요
                <span className="ml-1 text-sm font-normal text-gray-600">
                  ({outstanding.length}개 주기)
                </span>
              </p>
              <p className="text-sm leading-relaxed text-gray-700">
                {periods.length > 0 && `${periods.join(', ')} 요금입니다. `}
                {oldest &&
                  `가장 오래된 것은 ${daysSince(oldest.createdAt)}일째 남아 있습니다. `}
                {view.outstandingDiscount > 0 &&
                  `그 기간에 멤버십 할인을 ${won(view.outstandingDiscount)} 받았습니다. `}
                납부하기 전까지 이 고객은 멤버십을 새로 시작할 수 없습니다.
              </p>
              <p className="text-xs text-gray-500">
                혜택 금액은 멤버십 할인만 셉니다. 쿠폰·전용상품 이용은 이
                화면에서 집계하지 못합니다.
              </p>
            </>
          ) : (
            <p className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
              <CircleCheck className="size-4 text-emerald-600" aria-hidden />
              남은 미납 요금이 없습니다. 지난 기록만 아래에 남아 있습니다.
            </p>
          )}
        </CardContent>
      </Card>

      {view.unattachedMismatches.map((m) => (
        <p
          key={m.id}
          className="flex items-start gap-1.5 rounded-md bg-amber-50 p-2 text-xs text-amber-800"
        >
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          {formatDateTime(m.createdAt)} · {describeEvent(m).text}
        </p>
      ))}

      <div className="space-y-3">
        {view.items.map((item) => (
          <LineCard
            key={item.id}
            item={item}
            benefit={view.benefitsById.get(item.id)}
            adjustments={(data.adjustments ?? []).filter(
              (a) => a.arrearsId === item.id
            )}
            mismatches={view.mismatchesFor(item.id)}
            allowActions={allowActions}
            onAction={setAction}
          />
        ))}
      </div>

      {view.events.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="group inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900">
            미납 관련 기록 전체 {view.events.length}건
            <ChevronDown
              className="size-3.5 transition-transform group-data-[state=open]:rotate-180"
              aria-hidden
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ol className="mt-2 space-y-1 border-l border-gray-200 pl-3">
              {view.events.map((e) => {
                const d = describeEvent(e);
                return (
                  <li
                    key={e.id}
                    className={cn(
                      'text-xs',
                      d.needsAttention ? 'text-amber-800' : 'text-gray-700'
                    )}
                  >
                    <span className="text-gray-400">
                      {formatDateTime(e.createdAt)}
                    </span>{' '}
                    · {d.text}
                  </li>
                );
              })}
            </ol>
          </CollapsibleContent>
        </Collapsible>
      )}

      <ActionDialog
        userId={userId}
        action={action}
        onClose={() => setAction(null)}
      />
    </div>
  );
}
