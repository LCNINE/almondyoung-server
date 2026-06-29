// src/features/order/history/components/table/index.tsx
'use client';

import { useCallback, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { toast } from 'sonner';
import { useOrderHistoryFilter } from '../../contexts/filter.context';
import type {
  SalesOrderBusinessTimelineItemDto,
  SalesOrdersQuery,
} from '@/lib/types/dto/orders';
import {
  useSalesOrderRows,
  useCreatePickingLists,
} from '../../hooks/use-order-rows';
import { filterRefundIssueRows } from '../../hooks/refund-filter.utils';
import type { OrderLineRow } from '../../hooks/use-order-rows';
import { useSalesOrder, useAdminRetryRefund } from '@/lib/services/orders';
import { MergedDataTable } from '@/components/common/merged-data-table';
import type { MergedTableColumn } from '@/components/common/merged-data-table';
import { Table } from '@/components/admin-ui-experimental/common/table/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import SplitOrderModal from '../modals/split-order-modal';
import { EditOrderModal } from '../modals/edit-order-modal';
import { SplitQuantityModal } from '../modals/split-quantity-modal';
import { AddOrderItemModal } from '../modals/add-order-item-modal';
import { MemoModal } from '../modals/memo-modal';
import { CancelOrderModal } from '../modals/cancel-order-modal';
import { ManualRefundCompleteModal } from '../modals/manual-refund-complete-modal';

const PAGE_SIZE = 50;

function buildQuery(
  filter: ReturnType<typeof useOrderHistoryFilter>['filter']
): SalesOrdersQuery {
  return {
    channel: filter.channel as SalesOrdersQuery['channel'] | undefined,
    startDate: filter.dateFrom,
    endDate: filter.dateTo,
    limit: 200,
    offset: 0,
  };
}

/* ── 상태 배지 ────────────────────────────────────────────── */
function StatusBadge({ row }: { row: OrderLineRow }) {
  const { orderStatus, isMatched, lineStatus } = row;
  if (orderStatus === 'shipped' || orderStatus === 'delivered')
    return (
      <span className="inline-flex rounded-full bg-green-100 text-green-700 text-[11px] font-medium px-2 py-0.5 whitespace-nowrap">
        출고완료
      </span>
    );
  if (lineStatus === 'stock_deducted')
    return (
      <span className="inline-flex rounded-full bg-blue-100 text-blue-700 text-[11px] font-medium px-2 py-0.5 whitespace-nowrap">
        출고가능
      </span>
    );
  if (lineStatus === 'stock_unavailable')
    return (
      <span className="inline-flex rounded-full bg-red-100 text-red-600 text-[11px] font-medium px-2 py-0.5 whitespace-nowrap">
        출고불가
      </span>
    );
  if (!isMatched)
    return (
      <span className="inline-flex rounded-full bg-gray-100 text-gray-500 text-[11px] font-medium px-2 py-0.5 whitespace-nowrap">
        매칭 없음
      </span>
    );
  return (
    <span className="inline-flex rounded-full bg-orange-100 text-orange-600 text-[11px] font-medium px-2 py-0.5 whitespace-nowrap">
      매칭 안됨
    </span>
  );
}

/* ── 환불 상태 배지 ────────────────────────────────────────── */
const REFUND_STATUS_CONFIG: Record<
  string,
  { label: string; className: string }
> = {
  succeeded: { label: '환불 완료', className: 'bg-green-100 text-green-700' },
  pending: { label: '환불 처리중', className: 'bg-blue-100 text-blue-700' },
  failed: {
    label: '환불 실패',
    className: 'bg-red-100 text-red-700 ring-1 ring-inset ring-red-300',
  },
  manual_pending: {
    label: '수동처리 필요',
    className: 'bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-300',
  },
  none: { label: '환불 없음', className: 'bg-gray-100 text-gray-500' },
};

function RefundStatusBadge({ status }: { status: string }) {
  const cfg = REFUND_STATUS_CONFIG[status] ?? {
    label: status,
    className: 'bg-gray-100 text-gray-600',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}

function RetryRefundButton({
  orderId,
  onDone,
}: {
  orderId: string;
  onDone: (status: string) => void;
}) {
  const retryMutation = useAdminRetryRefund();
  return (
    <button
      className="h-6 px-2 rounded border border-orange-400 text-orange-600 hover:bg-orange-50 text-[11px] whitespace-nowrap disabled:opacity-50"
      disabled={retryMutation.isPending}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          const result = await retryMutation.mutateAsync(orderId);
          onDone(result.refundStatus);
          if (result.refundStatus === 'succeeded') {
            toast.success('환불이 완료되었습니다.');
          } else if (result.refundStatus === 'pending') {
            toast.info('환불 처리 중입니다. 잠시 후 결제 관리에서 확인하세요.');
          } else {
            toast.error('환불 재시도 실패. 결제 관리에서 수동 처리하세요.');
          }
        } catch {
          toast.error('환불 재시도 중 오류가 발생했습니다.');
        }
      }}
    >
      {retryMutation.isPending ? '처리중...' : '환불 재시도'}
    </button>
  );
}

function ViewPaymentButton({
  walletIntentId,
}: {
  walletIntentId?: string | null;
}) {
  if (!walletIntentId) return null;
  return (
    <button
      className="h-6 px-2 rounded border border-blue-300 text-blue-600 hover:bg-blue-50 text-[11px] whitespace-nowrap"
      onClick={(e) => {
        e.stopPropagation();
        window.open(
          `/payments/${encodeURIComponent(walletIntentId)}`,
          '_blank'
        );
      }}
    >
      결제 보기
    </button>
  );
}

function ManualCompleteButton({ onDone }: { onDone: () => void }) {
  return (
    <button
      className="h-6 px-2 rounded border border-amber-400 text-amber-700 hover:bg-amber-50 text-[11px] whitespace-nowrap"
      onClick={(e) => {
        e.stopPropagation();
        onDone();
      }}
    >
      수동 완료
    </button>
  );
}

/* ── 판매처 배지 ───────────────────────────────────────────── */
function ChannelBadge({ channel }: { channel: string }) {
  if (channel === 'naver')
    return (
      <div className="flex flex-col gap-0.5">
        <span className="inline-flex rounded bg-green-500 text-white text-[10px] font-bold px-1.5 py-0.5">
          N 스마트스토어
        </span>
        <span className="text-[10px] text-gray-500">아몬드영</span>
      </div>
    );
  if (channel === 'coupang')
    return (
      <span className="inline-flex rounded bg-yellow-400 text-black text-[10px] font-bold px-1.5 py-0.5">
        쿠팡
      </span>
    );
  if (channel === '3pl')
    return (
      <span className="inline-flex rounded bg-gray-200 text-gray-700 text-[10px] font-medium px-1.5 py-0.5">
        3PL
      </span>
    );
  return (
    <div className="flex items-center justify-center border rounded px-2 py-1 bg-white min-w-[72px]">
      <span className="text-[9px] font-bold tracking-tight text-gray-800 text-center leading-tight">
        ALMOND
        <br />
        YOUNG
      </span>
    </div>
  );
}

function formatBusinessRef(
  ref: SalesOrderBusinessTimelineItemDto['linkedEntity']
) {
  return ref.id ?? ref.externalRef ?? '-';
}

// ── Timeline 운영 레이블 맵 ──────────────────────────────────────────────
const RELATION_LABELS: Record<
  string,
  { label: string; color: string; icon: string }
> = {
  // 취소
  opened_cancellation: {
    label: '주문 취소 처리됨',
    color: 'bg-red-100 text-red-700',
    icon: '✕',
  },
  cancellation_cancelled_fulfillment_order: {
    label: '출고주문 취소됨',
    color: 'bg-orange-100 text-orange-700',
    icon: '📦',
  },
  cancellation_closed_fulfillment_creation_backlog: {
    label: '출고 대기 닫힘',
    color: 'bg-gray-100 text-gray-600',
    icon: '⏹',
  },
  cancellation_revoked_digital_ownership: {
    label: '디지털 권리 회수됨',
    color: 'bg-purple-100 text-purple-700',
    icon: '🔒',
  },
  cancellation_linked_wallet_refund: {
    label: '환불 연결됨',
    color: 'bg-blue-100 text-blue-700',
    icon: '💳',
  },
  cancellation_preserved_shipped_fulfillment_order_item: {
    label: '출고 항목 보존 (반품 필요)',
    color: 'bg-yellow-100 text-yellow-700',
    icon: '⚠️',
  },
  cancellation_post_shipment_handoff: {
    label: '출고 후 처리 이관',
    color: 'bg-yellow-100 text-yellow-700',
    icon: '🔄',
  },
  // CS
  opened_cs_case: {
    label: 'CS 케이스 생성됨',
    color: 'bg-indigo-100 text-indigo-700',
    icon: '📋',
  },
  // 반품/교환 (세부 이벤트는 LIFECYCLE_EVENT_LABELS에서 metadata.event로 처리)
  return_lifecycle_event: {
    label: '반품 이력',
    color: 'bg-amber-100 text-amber-700',
    icon: '↩️',
  },
  exchange_lifecycle_event: {
    label: '교환 이력',
    color: 'bg-amber-100 text-amber-700',
    icon: '🔁',
  },
  return_requested: {
    label: '반품 신청 접수됨',
    color: 'bg-amber-100 text-amber-700',
    icon: '↩️',
  },
  exchange_requested: {
    label: '교환 신청 접수됨',
    color: 'bg-amber-100 text-amber-700',
    icon: '🔁',
  },
  // 정정
  opened_amendment: {
    label: '주문 정정됨',
    color: 'bg-cyan-100 text-cyan-700',
    icon: '✏️',
  },
};

// metadata.event 기반 반품/교환 라이프사이클 이벤트 레이블
const LIFECYCLE_EVENT_LABELS: Record<
  string,
  { label: string; color: string; icon: string }
> = {
  return_approved: {
    label: '반품 승인됨',
    color: 'bg-green-100 text-green-700',
    icon: '↩️',
  },
  return_rejected: {
    label: '반품 거절됨',
    color: 'bg-red-100 text-red-700',
    icon: '↩️',
  },
  return_collection_pending: {
    label: '반품 수거 대기',
    color: 'bg-amber-100 text-amber-700',
    icon: '↩️',
  },
  return_collected: {
    label: '반품 수거 완료',
    color: 'bg-blue-100 text-blue-700',
    icon: '↩️',
  },
  return_inspected: {
    label: '반품 검수 완료',
    color: 'bg-blue-100 text-blue-700',
    icon: '↩️',
  },
  return_completed: {
    label: '반품 완료',
    color: 'bg-green-100 text-green-700',
    icon: '✅',
  },
  exchange_approved: {
    label: '교환 승인됨',
    color: 'bg-green-100 text-green-700',
    icon: '🔁',
  },
  exchange_rejected: {
    label: '교환 거절됨',
    color: 'bg-red-100 text-red-700',
    icon: '🔁',
  },
  exchange_collection_pending: {
    label: '교환 수거 대기',
    color: 'bg-amber-100 text-amber-700',
    icon: '🔁',
  },
  exchange_collected: {
    label: '교환 수거 완료',
    color: 'bg-blue-100 text-blue-700',
    icon: '🔁',
  },
  exchange_inspected: {
    label: '교환 검수 완료',
    color: 'bg-blue-100 text-blue-700',
    icon: '🔁',
  },
  exchange_completed: {
    label: '교환 완료',
    color: 'bg-green-100 text-green-700',
    icon: '✅',
  },
};

const ENTITY_TYPE_LABELS: Record<string, string> = {
  sales_order: '판매주문',
  order_cancellation: '주문취소',
  fulfillment_order: '출고주문',
  fulfillment_order_creation_backlog: '출고 대기',
  digital_asset_ownership: '디지털 자산',
  wallet_refund: '환불',
  wallet_payment_intent: '결제 인텐트',
  wallet_charge: '결제',
  cs_case: 'CS 케이스',
  sales_order_amendment: '주문 정정',
  return_handoff: '반품 이관',
  recovery_handoff: '회수 이관',
};

const EFFECT_STATUS_LABELS: Record<string, string> = {
  PENDING: '처리 중',
  SUCCEEDED: '완료',
  FAILED: '실패',
  MANUAL_PENDING: '수동 처리 대기',
  pending: '처리 중',
  succeeded: '완료',
  failed: '실패',
  manual_pending: '수동 처리 대기',
  requested: '접수됨',
  approved: '승인됨',
  rejected: '거절됨',
  collection_pending: '수거 대기',
  collected: '수거 완료',
  inspected: '검수 완료',
  completed: '완료',
};

function TimelineItem({ item }: { item: SalesOrderBusinessTimelineItemDto }) {
  const [showRaw, setShowRaw] = useState(false);

  // lifecycle 이벤트는 metadata.event로 세부 레이블 결정
  const metaEvent =
    typeof item.metadata?.event === 'string' ? item.metadata.event : null;
  const mapping =
    metaEvent && LIFECYCLE_EVENT_LABELS[metaEvent]
      ? LIFECYCLE_EVENT_LABELS[metaEvent]
      : (RELATION_LABELS[item.relationName] ?? {
          label: item.relationName,
          color: 'bg-gray-100 text-gray-600',
          icon: '•',
        });

  const entityLabel =
    ENTITY_TYPE_LABELS[item.linkedEntity.type] ?? item.linkedEntity.type;
  const ref = item.linkedEntity.id
    ? item.linkedEntity.id.slice(0, 8) + '…'
    : (item.linkedEntity.externalRef ?? '-');

  // 운영에 중요한 메타데이터 필드 추출
  const metaRefundStatus =
    typeof item.metadata?.refundStatus === 'string'
      ? item.metadata.refundStatus
      : null;
  const metaNote =
    typeof item.metadata?.note === 'string' ? item.metadata.note : null;
  const metaAdminNote =
    typeof item.metadata?.adminNote === 'string'
      ? item.metadata.adminNote
      : null;
  const displayNote = metaAdminNote ?? metaNote;

  // 상태 판정 (refundStatus 또는 lifecycle event 이름 기준)
  const statusValue = metaRefundStatus ?? metaEvent ?? null;
  const isFailed = Boolean(
    statusValue &&
    (statusValue === 'failed' ||
      statusValue === 'FAILED' ||
      statusValue.includes('rejected'))
  );
  const isPending = Boolean(
    statusValue &&
    (statusValue === 'pending' ||
      statusValue === 'manual_pending' ||
      statusValue === 'MANUAL_PENDING' ||
      statusValue === 'PENDING')
  );
  const isSucceeded = Boolean(
    statusValue &&
    (statusValue === 'succeeded' ||
      statusValue === 'SUCCEEDED' ||
      statusValue.includes('completed'))
  );

  const statusBadgeColor = isFailed
    ? 'bg-red-100 text-red-700'
    : isPending
      ? 'bg-amber-100 text-amber-700'
      : isSucceeded
        ? 'bg-green-100 text-green-700'
        : null;
  const statusLabel = metaRefundStatus
    ? (EFFECT_STATUS_LABELS[metaRefundStatus] ?? metaRefundStatus)
    : null;

  // 실패/대기 상태는 좌측 경계선으로 강조
  const leftBorder = isFailed
    ? 'border-l-2 border-red-400 pl-2'
    : isPending
      ? 'border-l-2 border-amber-400 pl-2'
      : '';

  const hasMetadata = Object.keys(item.metadata).length > 0;

  return (
    <div className={`flex gap-3 py-2.5 border-b last:border-0 ${leftBorder}`}>
      <div className="flex w-8 shrink-0 items-start justify-center pt-0.5 text-base">
        {mapping.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${mapping.color}`}
            >
              {mapping.label}
            </span>
            {statusLabel && statusBadgeColor && (
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeColor}`}
              >
                {statusLabel}
              </span>
            )}
            {isFailed && (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-red-50 text-red-600 ring-1 ring-inset ring-red-300">
                조치 필요
              </span>
            )}
            {isPending && !isFailed && (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-300">
                처리 대기
              </span>
            )}
          </div>
          <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">
            {dayjs(item.occurredAt).format('MM/DD HH:mm')}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-gray-500">{entityLabel}</span>
          <span className="font-mono">{ref}</span>
        </div>
        {displayNote && (
          <p
            className={`mt-1 text-xs break-words ${isFailed ? 'text-red-600 font-medium' : 'text-gray-600'}`}
          >
            {displayNote}
          </p>
        )}
        {hasMetadata && (
          <button
            className="mt-1 text-xs text-muted-foreground hover:text-gray-700 underline"
            onClick={() => setShowRaw((v) => !v)}
          >
            {showRaw ? '상세 닫기' : '상세 보기'}
          </button>
        )}
        {showRaw && (
          <pre className="mt-1 rounded bg-gray-50 p-2 text-xs text-gray-600 overflow-x-auto whitespace-pre-wrap max-h-40">
            {JSON.stringify(item.metadata, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function BusinessTimelineModal({
  order,
  open,
  onOpenChange,
}: {
  order: OrderLineRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading } = useSalesOrder(open && order ? order.orderId : '');
  const timeline = [...(data?.businessTimeline ?? [])].sort(
    (a, b) =>
      new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>주문 이력 타임라인</DialogTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            주문번호: {order?.orderNo ?? '-'}
          </p>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-sm text-muted-foreground">
              불러오는 중...
            </div>
          ) : timeline.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              아직 기록된 업무 이력이 없습니다.
            </div>
          ) : (
            <div className="px-1">
              {timeline.map((item) => (
                <TimelineItem key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────────────────────────────────────── */

export default function OrderTable() {
  const { filter, searchToken } = useOrderHistoryFilter();
  const queryObj = useMemo(
    () => ({ ...buildQuery(filter), _t: searchToken }),
    [filter, searchToken]
  );

  const { data, isLoading, isFetching } = useSalesOrderRows(queryObj);

  /* 클라이언트 사이드 필터 */
  const rows: OrderLineRow[] = useMemo(() => {
    let items = data?.items ?? [];

    if (filter.type !== 'all') {
      items = items.filter((r) => {
        switch (filter.type) {
          case 'pending':
            return r.orderStatus === 'pending';
          case 'hold':
            return r.isUnavailable;
          case 'partial':
            return r.isReadyToShip && !r.isOrderFullyAllocated;
          case 'ready':
            return r.isOrderFullyAllocated;
          case 'unmatched':
            return !r.isMatched;
          case 'direct':
            return r.isDirect;
          default:
            return true;
        }
      });
    } else if (filter.excludeTerminal) {
      items = items.filter(
        (r) => r.orderStatus !== 'cancelled' && r.orderStatus !== 'timeout'
      );
    }

    // 환불 이슈 필터: order 단위 — 해당 orderId의 모든 행 포함
    if (filter.refundIssueOnly) {
      items = filterRefundIssueRows(items);
    }

    if (filter.keyword) {
      const kw = filter.keyword.toLowerCase();
      items = items.filter((r) => {
        switch (filter.keywordType) {
          case '주문번호':
            return r.orderNo.toLowerCase().includes(kw);
          case '수령자':
            return (r.receiverName ?? '').toLowerCase().includes(kw);
          case '연락처':
            return (r.phone ?? '').includes(kw);
          case '상품명':
            return r.productName.toLowerCase().includes(kw);
          default:
            return (
              r.orderNo.toLowerCase().includes(kw) ||
              (r.receiverName ?? '').toLowerCase().includes(kw) ||
              (r.customerName ?? '').toLowerCase().includes(kw) ||
              (r.phone ?? '').includes(kw) ||
              r.productName.toLowerCase().includes(kw)
            );
        }
      });
    }

    return items;
  }, [
    data?.items,
    filter.type,
    filter.excludeTerminal,
    filter.refundIssueOnly,
    filter.keyword,
    filter.keywordType,
  ]);

  /* 선택 상태 (groupKey = orderId 기준) */
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(
    new Set()
  );

  const isOrderSelectable = (r: OrderLineRow) =>
    r.isOrderFullyAllocated && r.orderStatus === 'confirmed';

  const createPickingLists = useCreatePickingLists();

  /* 모달 상태 */
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showQuantityModal, setShowQuantityModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showMemoModal, setShowMemoModal] = useState(false);
  const [showTimelineModal, setShowTimelineModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showManualRefundModal, setShowManualRefundModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<OrderLineRow | null>(null);

  /* 액션 */
  const handleSelectedOutbound = useCallback(() => {
    if (!selectedOrderIds.size) return;
    createPickingLists.mutate(Array.from(selectedOrderIds), {
      onSuccess: (batches) => {
        const totalLinked = batches.reduce(
          (sum, b) => sum + (b?.linkedFoCount ?? 0),
          0
        );
        if (totalLinked > 0) {
          toast.success(
            `출고 지시 완료: ${totalLinked}건 주문처리가 배치에 할당됐습니다.`
          );
        } else {
          toast.warning(
            '배치가 생성됐지만 연결된 주문처리가 없습니다. 출고 가능 상태인지 확인하세요.'
          );
        }
        window.open('/order/outbound-batches', '_blank');
      },
      onError: (err: Error) => {
        toast.error(`출고 지시 실패: ${err.message ?? '알 수 없는 오류'}`);
      },
    });
  }, [selectedOrderIds, createPickingLists]);

  const handleBulkOutbound = useCallback(() => {
    const readyOrderIds = Array.from(
      new Set(
        rows
          .filter((r) => isOrderSelectable(r) && r.channel !== '3pl')
          .map((r) => r.orderId)
      )
    );
    if (!readyOrderIds.length) {
      toast.info('출고 가능한 주문이 없습니다. (3PL 주문은 제외됩니다)');
      return;
    }
    createPickingLists.mutate(readyOrderIds, {
      onSuccess: (batches) => {
        const totalLinked = batches.reduce(
          (sum, b) => sum + (b?.linkedFoCount ?? 0),
          0
        );
        toast.success(
          `일괄 출고 지시 완료: ${totalLinked}건 주문처리가 배치에 할당됐습니다.`
        );
        window.open('/order/outbound-batches', '_blank');
      },
      onError: (err: Error) => {
        toast.error(`일괄 출고 지시 실패: ${err.message ?? '알 수 없는 오류'}`);
      },
    });
  }, [rows, createPickingLists]);

  /* 페이지네이션 */
  const [page, setPage] = useState(0); // 0-based index (DataTable 방식)
  const totalPages = useMemo(
    () => Math.ceil(rows.length / PAGE_SIZE),
    [rows.length]
  );
  const pageRows = useMemo(
    () => rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [rows, page]
  );

  /* 컬럼 정의 */
  const columns: MergedTableColumn<OrderLineRow>[] = useMemo(
    () => [
      {
        key: 'rowSeq',
        label: '#',
        width: '36px',
        merged: true,
        align: 'center',
        render: (_, r) => (
          <span className="text-[10px] text-gray-400">{r.rowSeq}</span>
        ),
      },
      {
        key: 'orderDate',
        label: '주문일자',
        merged: true,
        render: (_, r) => (
          <span className="whitespace-nowrap">
            {dayjs(r.orderDate).format('YYYY-MM-DD')}
          </span>
        ),
      },
      {
        key: 'channel',
        label: '판매처',
        merged: true,
        render: (_, r) => <ChannelBadge channel={r.channel} />,
      },
      {
        key: 'orderNo',
        label: '주문번호\n연락처',
        merged: true,
        render: (_, r) => (
          <div>
            <button
              className="text-blue-600 hover:underline font-medium block text-left"
              onClick={() =>
                window.open(
                  `/cs?orderId=${encodeURIComponent(r.orderId)}&orderNo=${encodeURIComponent(r.orderNo)}`,
                  '_blank'
                )
              }
            >
              {r.orderNo}
            </button>
            {r.phone && <div className="text-blue-500 mt-0.5">{r.phone}</div>}
          </div>
        ),
      },
      {
        key: 'productName',
        label: '상품',
        render: (_, r) => (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <StatusBadge row={r} />
              <span className="font-medium">{r.productName}</span>
            </div>
            {r.optionName && (
              <div className="text-gray-500">{r.optionName}</div>
            )}
          </div>
        ),
      },
      {
        key: 'imageUrl',
        label: '이미지',
        width: '52px',
        render: (_, r) =>
          r.imageUrl ? (
            <img
              src={r.imageUrl}
              alt={r.productName}
              className="w-10 h-10 object-cover rounded border"
            />
          ) : (
            <div className="w-10 h-10 rounded border bg-gray-50" />
          ),
      },
      {
        key: 'quantity',
        label: '수량',
        width: '48px',
        align: 'center',
        render: (val) => <span className="font-medium">{val as number}</span>,
      },
      {
        key: '_actions',
        label: '기능',
        width: '108px',
        render: (_, r) => (
          <div className="flex flex-col gap-1">
            <button
              className="h-7 px-2 rounded border hover:bg-gray-50 whitespace-nowrap text-xs"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedOrder(r);
                setShowEditModal(true);
              }}
            >
              입력확인
            </button>
            {/* stub: API 미구현 — 클릭 불가 */}
            <button
              disabled
              className="h-7 px-2 rounded border border-gray-200 bg-gray-50 whitespace-nowrap text-xs text-gray-400 cursor-not-allowed"
              title="준비 중: Core 주문분할 API 필요"
            >
              주문추가
            </button>
            <button
              disabled
              className="h-7 px-2 rounded border border-gray-200 bg-gray-50 whitespace-nowrap text-xs text-gray-400 cursor-not-allowed"
              title="준비 중: Core 주문분할 API 필요"
            >
              수량나누기
            </button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedOrder(r);
                setShowTimelineModal(true);
              }}
            >
              업무연결
            </Button>
            {r.orderStatus === 'cancelled' ? (
              <div className="flex flex-col gap-1">
                <span className="inline-flex items-center h-7 px-2 rounded border border-gray-200 bg-gray-50 text-xs text-gray-500 whitespace-nowrap">
                  취소됨
                </span>
                {r.isFirstOfOrder && r.refundStatus && (
                  <RefundStatusBadge status={r.refundStatus} />
                )}
                {r.isFirstOfOrder && r.refundStatus === 'failed' && (
                  <RetryRefundButton orderId={r.orderId} onDone={() => {}} />
                )}
                {r.isFirstOfOrder && r.refundStatus === 'failed' && (
                  <ViewPaymentButton walletIntentId={r.walletIntentId} />
                )}
                {r.isFirstOfOrder && r.refundStatus === 'manual_pending' && (
                  <>
                    <ManualCompleteButton
                      onDone={() => {
                        setSelectedOrder(r);
                        setShowManualRefundModal(true);
                      }}
                    />
                    {r.refundEstimateAmount != null && r.refundEstimateAmount > 0 && (
                      <span className="text-[11px] text-amber-700 whitespace-nowrap">
                        추정: {r.refundEstimateAmount.toLocaleString()}원
                      </span>
                    )}
                    {r.channel !== 'medusa' && (
                      <span className="text-[10px] text-gray-500 whitespace-normal leading-tight">
                        채널 관리자센터 처리 후 완료 확인
                      </span>
                    )}
                    <ViewPaymentButton walletIntentId={r.walletIntentId} />
                  </>
                )}
                {r.isFirstOfOrder && r.refundStatus === 'succeeded' && (
                  <ViewPaymentButton walletIntentId={r.walletIntentId} />
                )}
                {r.isFirstOfOrder && r.refundStatus === 'pending' && (
                  <ViewPaymentButton walletIntentId={r.walletIntentId} />
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs text-red-600 border-red-300 hover:bg-red-50"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedOrder(r);
                    setShowCancelModal(true);
                  }}
                >
                  {r.orderStatus === 'processing' ? '강제취소' : '취소'}
                </Button>
                {r.isFirstOfOrder && r.refundStatus === 'manual_pending' && (
                  <>
                    <RefundStatusBadge status={r.refundStatus} />
                    {r.refundEstimateAmount != null && r.refundEstimateAmount > 0 && (
                      <span className="text-[11px] text-amber-700 whitespace-nowrap">
                        추정: {r.refundEstimateAmount.toLocaleString()}원
                      </span>
                    )}
                    {r.channel !== 'medusa' && (
                      <span className="text-[10px] text-gray-500 whitespace-normal leading-tight">
                        채널 관리자센터 처리 후 완료 확인
                      </span>
                    )}
                    <ManualCompleteButton
                      onDone={() => {
                        setSelectedOrder(r);
                        setShowManualRefundModal(true);
                      }}
                    />
                    <ViewPaymentButton walletIntentId={r.walletIntentId} />
                  </>
                )}
              </div>
            )}
          </div>
        ),
      },
      {
        key: 'totalPrice',
        label: '금액',
        align: 'right',
        render: (_, r) => {
          const amount = r.totalPrice ?? r.unitPrice;
          return amount != null ? (
            <span className="whitespace-nowrap">
              {amount.toLocaleString()}원
            </span>
          ) : (
            '-'
          );
        },
      },
      {
        key: 'customerName',
        label: '주문자/수령자',
        merged: true,
        render: (_, r) => (
          <div>
            {(r.customerName || r.receiverName) && (
              <div className="font-medium">
                {r.customerName ?? '-'} / {r.receiverName ?? '-'}
              </div>
            )}
            {r.totalAmount != null && (
              <div className="text-gray-500 mt-0.5">
                합계: {r.totalAmount.toLocaleString()}
              </div>
            )}
            {r.personalCustomsCode && (
              <div className="text-amber-600 mt-0.5">
                통관부호: {r.personalCustomsCode}
              </div>
            )}
            {r.address && (
              <div className="text-blue-500 mt-0.5 cursor-pointer hover:underline">
                배송추적
              </div>
            )}
          </div>
        ),
      },
      {
        key: 'shippingFee',
        label: '배송방법',
        render: (_, r) => (
          <div className="flex flex-col gap-1">
            <span className="text-gray-700">
              {r.shippingFee === 0
                ? '선불'
                : `${(r.shippingFee ?? 0).toLocaleString()}원`}
            </span>
            {/* stub: Core 주문분할 API 미구현 */}
            <button
              disabled
              className="h-6 px-2 rounded border border-gray-200 bg-gray-50 text-gray-400 text-[11px] w-fit cursor-not-allowed"
              title="준비 중: Core 주문분할 API 필요"
            >
              나누기
            </button>
          </div>
        ),
      },
      {
        key: 'lineStatus',
        label: 'C/S 상태',
        render: (_, r) =>
          r.lineStatus === 'stock_unavailable' ? (
            <span className="text-gray-500">입고 후 발송</span>
          ) : (
            <button
              className="h-7 px-2 rounded border hover:bg-gray-50 whitespace-nowrap text-xs"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedOrder(r);
                setShowMemoModal(true);
              }}
            >
              메모추가
            </button>
          ),
      },
    ],
    []
  );

  return (
    <>
      <div className="rounded-xl border bg-white">
        {/* 헤더 액션 바 */}
        <div className="flex items-center justify-between p-3 border-b gap-2 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="text-sm font-medium">
              총 <b className="text-blue-600">{rows.length}</b>건
            </div>
            {isFetching && (
              <span className="text-xs text-gray-400">(갱신 중)</span>
            )}
            {filter.type === 'pending' && (
              <span className="text-xs text-amber-600 font-medium">
                미확정 주문만 표시 중
              </span>
            )}
            {filter.type === 'all' && filter.excludeTerminal && (
              <span className="text-xs text-gray-500">
                취소/타임아웃 제외 중
              </span>
            )}
            {filter.refundIssueOnly && (
              <span className="text-xs text-orange-600 font-medium">
                환불 실패/수동처리 주문만 표시 중
              </span>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              className="px-3 h-9 rounded border text-sm hover:bg-gray-50"
              onClick={() => {
                /* TODO: 엑셀 다운로드 */
              }}
            >
              엑셀 다운로드
            </button>
            <button
              disabled={!selectedOrderIds.size || createPickingLists.isPending}
              className="px-3 h-9 rounded bg-orange-500 text-white text-sm disabled:opacity-50 hover:bg-orange-600"
              onClick={handleSelectedOutbound}
            >
              {createPickingLists.isPending
                ? '처리 중...'
                : `선택된 주문 출고 지시 (${selectedOrderIds.size})`}
            </button>
            <button
              disabled={createPickingLists.isPending}
              className="px-3 h-9 rounded bg-orange-400 text-white text-sm disabled:opacity-50 hover:bg-orange-500"
              onClick={handleBulkOutbound}
            >
              일괄 출고 지시
            </button>
          </div>
        </div>

        {/* 테이블 */}
        <MergedDataTable<OrderLineRow>
          data={pageRows}
          columns={columns as MergedTableColumn<OrderLineRow>[]}
          rowKey="rowId"
          groupKey="orderId"
          selectable
          mergeCheckbox
          selectedRowKeys={selectedOrderIds}
          onSelectedRowKeysChange={setSelectedOrderIds}
          isRowSelectable={isOrderSelectable}
          selectedRowClassName="bg-orange-50"
          emptyMessage={
            '조회된 주문이 없습니다. "검색" 버튼을 눌러 조회하세요.'
          }
          className="p-0"
          loading={isLoading}
          isFetching={isFetching}
          getRowClassName={(r) =>
            r.orderStatus === 'cancelled' ? 'opacity-50' : ''
          }
        />

        {/* 페이지네이션 - DataTable과 동일한 방식 */}
        <Table.Pagination
          count={rows.length}
          pageSize={PAGE_SIZE}
          pageIndex={page}
          pageCount={totalPages}
          canPreviousPage={page > 0}
          canNextPage={page < totalPages - 1}
          previousPage={() => setPage((p) => Math.max(0, p - 1))}
          nextPage={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          goPage={(idx) => setPage(idx)}
        />
      </div>

      {selectedOrder && (
        <SplitOrderModal
          order={selectedOrder}
          open={showSplitModal}
          onOpenChange={setShowSplitModal}
        />
      )}
      {selectedOrder && (
        <EditOrderModal
          order={selectedOrder}
          open={showEditModal}
          onOpenChange={setShowEditModal}
        />
      )}
      {selectedOrder && (
        <SplitQuantityModal
          order={selectedOrder}
          open={showQuantityModal}
          onOpenChange={setShowQuantityModal}
        />
      )}
      {selectedOrder && (
        <AddOrderItemModal
          order={selectedOrder}
          open={showAddModal}
          onOpenChange={setShowAddModal}
        />
      )}
      {selectedOrder && (
        <MemoModal
          order={selectedOrder}
          open={showMemoModal}
          onOpenChange={setShowMemoModal}
        />
      )}
      <BusinessTimelineModal
        order={selectedOrder}
        open={showTimelineModal}
        onOpenChange={setShowTimelineModal}
      />
      <CancelOrderModal
        order={selectedOrder}
        open={showCancelModal}
        onOpenChange={setShowCancelModal}
      />
      <ManualRefundCompleteModal
        order={selectedOrder}
        open={showManualRefundModal}
        onOpenChange={setShowManualRefundModal}
      />
    </>
  );
}
