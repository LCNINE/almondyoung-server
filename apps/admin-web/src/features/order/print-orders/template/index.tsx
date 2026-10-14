'use client';

import { useState } from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  PRINT_ORDER_PAGE_SIZE,
  PRINT_ORDER_STATUS_LABEL,
  PRINT_ORDER_STATUSES,
  isPrintOrderStatus,
  type PrintOrderBoardItem,
  type PrintOrderStatus,
  type PrintOrderTab,
} from '@/lib/api/domains/orders/print-orders.client';
import {
  printOrderErrorMessage,
  useConfirmTestPrintOrder,
  usePrintOrders,
  usePrintOrderSummary,
  useResolveCancelPrintOrder,
  useRetryPrintOrder,
} from '@/lib/services/orders/print-orders.queries';
import { formatDateTime } from '@/lib/utils/date';
import { cn } from '@/lib/utils/ui';

type Action =
  | {
      kind: 'resolve';
      row: PrintOrderBoardItem;
      outcome: 'cancelled' | 'proceed';
    }
  | { kind: 'retry'; row: PrintOrderBoardItem }
  | { kind: 'confirm'; row: PrintOrderBoardItem };

function elapsed(iso: string, now: number): string {
  const min = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

const TABS: { key: PrintOrderTab; label: string }[] = [
  { key: 'cancel_refused', label: '취소 확인 필요' },
  { key: 'test_pending', label: '테스트 확인대기' },
  { key: 'failed', label: '발주 실패' },
  { key: 'unsupported', label: '미지원 품목' },
  { key: 'all', label: '전체' },
];

function copy(text: string) {
  void navigator.clipboard
    .writeText(text)
    .then(() => toast.success('복사했습니다.'))
    .catch(() => toast.error('복사하지 못했습니다.'));
}

export default function PrintOrdersTemplate() {
  const [tab, setTab] = useState<PrintOrderTab>('cancel_refused');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<Action | null>(null);
  const [statusFilter, setStatusFilter] = useState<PrintOrderStatus | ''>('');

  const summary = usePrintOrderSummary();
  const list = usePrintOrders(tab, query, page);

  const counts: Record<PrintOrderTab, number> = {
    cancel_refused: summary.data?.cancelRefused ?? 0,
    test_pending: summary.data?.testPending ?? 0,
    failed: summary.data?.failed ?? 0,
    unsupported: summary.data?.unsupported ?? 0,
    all: summary.data?.total ?? 0,
  };

  const selectTab = (next: PrintOrderTab) => {
    setTab(next);
    setPage(1);
  };

  const pageItems = list.data?.items ?? [];
  const items =
    tab === 'all' && statusFilter
      ? pageItems.filter((r) => r.status === statusFilter)
      : pageItems;
  const total = list.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PRINT_ORDER_PAGE_SIZE));

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-end justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900">와우프레스 발주</h1>
        {list.dataUpdatedAt > 0 && (
          <span className="text-xs text-gray-500">
            마지막 갱신 {formatDateTime(new Date(list.dataUpdatedAt))} · 송장
            조회 30분마다
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {TABS.map(({ key, label }) => {
          const danger = key === 'cancel_refused' && counts[key] > 0;
          return (
            <button
              key={key}
              type="button"
              onClick={() => selectTab(key)}
              className={cn(
                'rounded-md border bg-white p-3 text-left',
                tab === key
                  ? 'border-gray-900 ring-1 ring-gray-900'
                  : 'border-gray-200'
              )}
            >
              <div className="text-xs text-gray-600">{label}</div>
              <div className="mt-1">
                {danger ? (
                  <Badge variant="destructive" className="text-base">
                    {counts[key]}
                  </Badge>
                ) : (
                  <span className="text-2xl font-bold text-gray-900">
                    {summary.data ? counts[key] : '-'}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q.trim());
          setPage(1);
        }}
      >
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="주문번호·고객·연락처·와우프레스 번호·상품명 검색"
          maxLength={100}
          className="max-w-md"
        />
        <Button type="submit" variant="outline">
          검색
        </Button>
        {tab === 'all' && (
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(
                isPrintOrderStatus(e.target.value) ? e.target.value : ''
              )
            }
            aria-label="상태 필터 (현재 페이지)"
            className="rounded-md border border-gray-300 bg-white px-2 text-sm"
          >
            <option value="">모든 상태 (현재 페이지)</option>
            {PRINT_ORDER_STATUSES.map((st) => (
              <option key={st} value={st}>
                {PRINT_ORDER_STATUS_LABEL[st]}
              </option>
            ))}
          </select>
        )}
      </form>

      <TooltipProvider>
        <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                <th className="p-2">우리 주문</th>
                <th className="p-2">고객</th>
                <th className="p-2">와우프레스 주문번호</th>
                <th className="p-2">품목</th>
                <th className="p-2">상태</th>
                <th className="p-2">시각</th>
                <th className="p-2">조치</th>
              </tr>
            </thead>
            <tbody>
              {list.isLoading && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-gray-400">
                    불러오는 중…
                  </td>
                </tr>
              )}
              {list.isError && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-gray-700">
                    목록을 불러오지 못했습니다.{' '}
                    {printOrderErrorMessage(list.error)}
                  </td>
                </tr>
              )}
              {list.isSuccess && items.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-gray-400">
                    처리할 건이 없습니다.
                  </td>
                </tr>
              )}
              {items.map((row) => (
                <PrintOrderRow key={row.id} row={row} onAction={setAction} />
              ))}
            </tbody>
          </table>
        </div>
      </TooltipProvider>

      <div className="flex items-center justify-between text-sm text-gray-600">
        <span>총 {total}건</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            이전
          </Button>
          <span>
            {page} / {lastPage}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= lastPage}
            onClick={() => setPage((p) => p + 1)}
          >
            다음
          </Button>
        </div>
      </div>

      <p className="text-xs text-gray-500">
        와우프레스 파일상담 1670-7645 · 평일 09–18시
      </p>

      <ActionDialog action={action} onClose={() => setAction(null)} />
    </div>
  );
}

function PrintOrderRow({
  row,
  onAction,
}: {
  row: PrintOrderBoardItem;
  onAction: (a: Action) => void;
}) {
  const [open, setOpen] = useState(false);
  const showSalesRetry =
    row.resolvable && row.status === 'cancelled' && row.salesCancelFailed;
  const showResolve = row.resolvable && !showSalesRetry;
  const awaitingTest =
    row.testMemo && !row.testConfirmedAt && row.status !== 'cancelled';
  const retryable = row.status === 'failed' || row.status === 'unsupported';
  const blocked = row.retryBlocked;
  const orderNumber = row.vendorOrderNumber;

  return (
    <>
      <tr className="border-b border-gray-100 align-top">
        <td className="p-2">
          <div className="font-semibold text-gray-900">
            {row.displayOrderNo ?? row.channelOrderId}
          </div>
          {row.testMemo && (
            <Badge variant="outline" className="mt-1">
              테스트
            </Badge>
          )}
        </td>
        <td className="p-2">
          <div>{row.customerName ?? '-'}</div>
          <div className="text-xs text-gray-500">{row.customerPhone ?? ''}</div>
        </td>
        <td className="p-2">
          {orderNumber ? (
            <span className="inline-flex items-center gap-1 font-mono">
              {orderNumber}
              <button
                type="button"
                aria-label="와우프레스 주문번호 복사"
                onClick={() => copy(orderNumber)}
                className="rounded p-1 text-gray-500 hover:bg-gray-100"
              >
                <Copy className="size-3.5" />
              </button>
            </span>
          ) : (
            <span className="text-gray-400">-</span>
          )}
        </td>
        <td className="p-2">{row.productName}</td>
        <td className="p-2">
          <div className="font-semibold text-gray-900">
            {PRINT_ORDER_STATUS_LABEL[row.status]}
          </div>
          {row.trackingNumber && (
            <div className="text-xs text-gray-500">
              {row.carrier ?? ''} {row.trackingNumber}
            </div>
          )}
          {row.lastError && (
            <button
              type="button"
              className="mt-1 text-xs text-gray-600 underline"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? '사유 접기' : '사유 펼치기'}
            </button>
          )}
        </td>
        <td
          className="p-2 text-xs text-gray-600"
          title={formatDateTime(row.updatedAt)}
        >
          {elapsed(row.updatedAt, Date.now())}
        </td>
        <td className="p-2">
          <div className="flex flex-wrap gap-1.5">
            {showSalesRetry && (
              <Button
                size="sm"
                onClick={() =>
                  onAction({ kind: 'resolve', row, outcome: 'cancelled' })
                }
              >
                판매주문 취소 다시 시도
              </Button>
            )}
            {showResolve && (
              <>
                <Button
                  size="sm"
                  onClick={() =>
                    onAction({ kind: 'resolve', row, outcome: 'cancelled' })
                  }
                >
                  취소 완료함
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    onAction({ kind: 'resolve', row, outcome: 'proceed' })
                  }
                >
                  생산 진행으로 처리
                </Button>
              </>
            )}
            {awaitingTest && (
              <Button
                size="sm"
                onClick={() => onAction({ kind: 'confirm', row })}
              >
                확인 완료
              </Button>
            )}
            {retryable &&
              (blocked ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0}>
                      <Button size="sm" variant="outline" disabled>
                        재전송
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    와우프레스에서 직접 확인·처리가 필요한 건입니다.
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onAction({ kind: 'retry', row })}
                >
                  재전송
                </Button>
              ))}
            {row.status === 'unsupported' && (
              <span className="basis-full text-xs text-gray-500">
                상품 매핑을 추가한 뒤 재전송하세요.
              </span>
            )}
          </div>
        </td>
      </tr>
      {open && row.lastError && (
        <tr className="border-b border-gray-100 bg-gray-50">
          <td
            colSpan={7}
            className="p-2 text-xs whitespace-pre-wrap text-gray-700"
          >
            {row.lastError}
          </td>
        </tr>
      )}
    </>
  );
}

function ActionDialog({
  action,
  onClose,
}: {
  action: Action | null;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [verified, setVerified] = useState(false);
  const retry = useRetryPrintOrder();
  const confirmTest = useConfirmTestPrintOrder();
  const resolve = useResolveCancelPrintOrder();

  const close = () => {
    setNote('');
    setVerified(false);
    onClose();
  };

  const done = (message: string) => {
    toast.success(message);
    close();
  };
  const fail = (error: unknown) => toast.error(printOrderErrorMessage(error));

  if (!action) return null;
  const { row } = action;
  const orderNo = row.displayOrderNo ?? row.channelOrderId;
  const showRetrySales = row.status === 'cancelled' && row.salesCancelFailed;
  const verifyRetry = action.kind === 'retry' && row.needsWowpressCheck;
  const pending = retry.isPending || confirmTest.isPending || resolve.isPending;

  const title =
    action.kind === 'resolve'
      ? action.outcome === 'cancelled'
        ? showRetrySales
          ? '판매주문 취소 다시 시도'
          : '취소 완료함으로 처리'
        : '생산 진행으로 처리'
      : action.kind === 'retry'
        ? '와우프레스로 재전송'
        : '테스트 건 확인 완료';

  const description =
    action.kind === 'resolve'
      ? action.outcome === 'cancelled'
        ? showRetrySales
          ? `주문 ${orderNo}: 인쇄는 취소됐지만 판매주문 취소(환불)가 열리지 않았습니다. 판매주문 취소를 다시 요청합니다.`
          : `주문 ${orderNo}: 와우프레스에서 취소된 것을 확인했습니다. 발주를 취소로 바꾸고 고객 주문 취소·환불을 진행합니다.`
        : `주문 ${orderNo}: 와우프레스에서 취소할 수 없어 제작을 그대로 진행합니다. 고객 주문은 취소되지 않습니다.`
      : action.kind === 'retry'
        ? `주문 ${orderNo}을(를) 와우프레스로 다시 보냅니다.`
        : `주문 ${orderNo}: 와우프레스 파일상담 확인 결과를 메모로 남깁니다.`;

  const submit = () => {
    if (action.kind === 'resolve') {
      resolve.mutate(
        { id: row.id, outcome: action.outcome },
        {
          onSuccess: (res) =>
            done(
              action.outcome === 'proceed'
                ? '생산 진행으로 처리했습니다.'
                : res.salesCancel === null
                  ? '판매주문에 취소할 남은 수량이 없어 인쇄만 정리했습니다.'
                  : '판매주문 취소를 요청했습니다.'
            ),
          onError: fail,
        }
      );
    } else if (action.kind === 'retry') {
      retry.mutate(
        { id: row.id, confirmNoWowpressOrder: verifyRetry && verified },
        { onSuccess: () => done('재전송을 요청했습니다.'), onError: fail }
      );
    } else {
      confirmTest.mutate(
        { id: row.id, note: note.trim() },
        { onSuccess: () => done('확인 완료로 처리했습니다.'), onError: fail }
      );
    }
  };

  const disabled =
    pending ||
    (action.kind === 'confirm' && note.trim().length === 0) ||
    (verifyRetry && !verified);

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {action.kind === 'confirm' && (
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            placeholder="확인 결과 (출력 가능 / 수정 필요 등)"
          />
        )}
        {verifyRetry && (
          <label className="flex items-start gap-2 text-sm text-gray-900">
            <Checkbox
              checked={verified}
              onCheckedChange={(c) => setVerified(c === true)}
            />
            <span>와우프레스에 이 주문이 없는 것을 확인했습니다</span>
          </label>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={pending}>
            닫기
          </Button>
          <Button onClick={submit} disabled={disabled}>
            확인
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
