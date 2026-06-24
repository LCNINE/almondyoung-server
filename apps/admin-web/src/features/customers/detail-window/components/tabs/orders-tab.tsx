'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Package } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils/ui';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import { useCustomerById } from '@/lib/services/customers';
import {
  useMedusaCustomerByEmail,
  useMedusaOrdersByCustomerId,
  useMedusaOrderById,
} from '@/lib/services/medusa-customers';
import type { AdminOrder } from '@/lib/api/domains/medusa';
import {
  formatDateTime,
  computeDateRange,
  DATE_PRESET_OPTIONS,
  type DatePreset,
} from '@/lib/utils/date';
import {
  formatCurrency,
  paymentStatusLabel,
  fulfillmentStatusLabel,
  membershipLabel,
  PAYMENT_STATUS_OPTIONS,
  FULFILLMENT_STATUS_OPTIONS,
} from '../../lib/order-labels';
import {
  orderPaymentMethods,
  fulfillmentBuckets,
  itemStatusLabel,
  summarizeItemNames,
  itemOrderNo,
} from '../../lib/order-view';

const PAGE_SIZE = 10;
// 한 회원 기준이라 보통 충분. 이 한도를 넘으면 기간을 좁히도록 안내한다.
const FETCH_LIMIT = 100;
const ALL = 'all';

// 기간 프리셋은 공용 유틸을 사용하되 'custom'(임의기간)은 직접 입력으로 대체
const PRESET_BUTTONS = DATE_PRESET_OPTIONS.filter((p) => p.value !== 'custom');

type BadgeVariant = 'default' | 'secondary' | 'destructive';
type ViewMode = 'by-order' | 'by-item';

interface OrdererInfo {
  username?: string | null;
  email?: string | null;
  roles?: string[];
}

function toIsoStart(date: string): string | undefined {
  return date ? `${date}T00:00:00.000Z` : undefined;
}
function toIsoEnd(date: string): string | undefined {
  return date ? `${date}T23:59:59.999Z` : undefined;
}

function paymentBadgeVariant(status: string): BadgeVariant {
  if (status === 'captured') return 'default';
  if (['refunded', 'partially_refunded', 'canceled'].includes(status)) {
    return 'destructive';
  }
  return 'secondary';
}

function fulfillmentBadgeVariant(status: string): BadgeVariant {
  if (
    ['shipped', 'partially_shipped', 'delivered', 'partially_delivered'].includes(
      status
    )
  ) {
    return 'default';
  }
  if (status === 'canceled') return 'destructive';
  return 'secondary';
}

function PaymentMethods({ order }: { order: AdminOrder }) {
  const methods = orderPaymentMethods(order);
  if (methods.length === 0) return <span className="text-gray-400">-</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {methods.map((m) => (
        <Badge
          key={m}
          variant="outline"
          title={m}
          className="px-1.5 py-0 text-[11px]"
        >
          <span className="block max-w-[72px] truncate">{m}</span>
        </Badge>
      ))}
    </div>
  );
}

function OrdererCell({
  customer,
  totalCount,
}: {
  customer: OrdererInfo | undefined;
  totalCount?: number;
}) {
  return (
    <div className="space-y-0.5 text-xs leading-tight">
      <div className="font-medium text-gray-900">
        {customer?.username ?? '-'}
      </div>
      {customer?.email && (
        <div className="text-gray-500">{customer.email}</div>
      )}
      <div className="text-gray-400">[{membershipLabel(customer?.roles)}]</div>
      {totalCount != null && (
        <div className="text-gray-400">(총 {totalCount.toLocaleString()}건)</div>
      )}
    </div>
  );
}

function AmountRow({
  label,
  value,
  currencyCode,
  emphasize,
}: {
  label: string;
  value: number | null | undefined;
  currencyCode: string | null | undefined;
  emphasize?: boolean;
}) {
  return (
    <div className="flex justify-between py-1 text-sm">
      <span className="text-gray-500">{label}</span>
      <span
        className={emphasize ? 'font-semibold text-gray-900' : 'text-gray-800'}
      >
        {formatCurrency(value, currencyCode)}
      </span>
    </div>
  );
}

/** 주문 상세 다이얼로그 (단건 조회로 라인 아이템/배송지/금액 표시) */
function OrderDetailDialog({
  orderId,
  onClose,
}: {
  orderId: string | null;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useMedusaOrderById(orderId ?? undefined);
  const order = data?.order;
  const currency = order?.currency_code;
  const address = order?.shipping_address;

  return (
    <Dialog open={!!orderId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-left">
            {order ? `주문 #${order.display_id}` : '주문 상세'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            주문 상세 정보
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : isError || !order ? (
          <div className="py-10 text-center text-sm text-red-400">
            주문 정보를 불러오지 못했습니다.
          </div>
        ) : (
          <div className="space-y-4">
            {/* 상태 요약 */}
            <dl className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
              <div className="grid grid-cols-[80px_1fr] gap-2 py-1.5 text-sm">
                <dt className="text-gray-500">주문일</dt>
                <dd className="text-gray-900">
                  {formatDateTime(order.created_at)}
                </dd>
              </div>
              <div className="grid grid-cols-[80px_1fr] items-center gap-2 py-1.5 text-sm">
                <dt className="text-gray-500">결제수단</dt>
                <dd>
                  <PaymentMethods order={order} />
                </dd>
              </div>
              <div className="grid grid-cols-[80px_1fr] items-center gap-2 py-1.5 text-sm">
                <dt className="text-gray-500">결제상태</dt>
                <dd>
                  <Badge variant={paymentBadgeVariant(order.payment_status)}>
                    {paymentStatusLabel(order.payment_status)}
                  </Badge>
                </dd>
              </div>
              <div className="grid grid-cols-[80px_1fr] items-center gap-2 py-1.5 text-sm">
                <dt className="text-gray-500">배송상태</dt>
                <dd>
                  <Badge
                    variant={fulfillmentBadgeVariant(order.fulfillment_status)}
                  >
                    {fulfillmentStatusLabel(order.fulfillment_status)}
                  </Badge>
                </dd>
              </div>
            </dl>

            {/* 주문 상품 */}
            <section>
              <h3 className="mb-1.5 text-sm font-semibold text-gray-800">
                주문 상품 ({order.items?.length ?? 0}개)
              </h3>
              <ul className="divide-y divide-gray-100 rounded-md border border-gray-100">
                {(order.items ?? []).map((item) => (
                  <li key={item.id} className="flex gap-3 p-2.5">
                    {resolvePublicFileUrl(item.thumbnail) ? (
                      // 외부 CDN(메두사) 이미지라 next/image 대신 img 사용
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={resolvePublicFileUrl(item.thumbnail) ?? ''}
                        alt={item.title}
                        className="size-12 shrink-0 rounded-md border object-cover"
                      />
                    ) : (
                      <div className="flex size-12 shrink-0 items-center justify-center rounded-md border bg-gray-50 text-gray-300">
                        <Package className="size-5" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-gray-900">
                        {item.product_title ?? item.title}
                      </div>
                      {item.variant_title && (
                        <div className="truncate text-xs text-gray-500">
                          옵션 : {item.variant_title}
                        </div>
                      )}
                      <div className="mt-0.5 text-xs text-gray-500">
                        {formatCurrency(item.unit_price, currency)} ×{' '}
                        {item.quantity}
                      </div>
                    </div>
                    <div className="shrink-0 self-center text-sm text-gray-900">
                      {formatCurrency(item.total, currency)}
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {/* 결제 금액 */}
            <section className="rounded-md border border-gray-100 px-3 py-2">
              <AmountRow
                label="상품금액"
                value={order.item_subtotal ?? order.subtotal}
                currencyCode={currency}
              />
              <AmountRow
                label="배송비"
                value={order.shipping_total}
                currencyCode={currency}
              />
              {!!order.discount_total && (
                <AmountRow
                  label="할인"
                  value={-Number(order.discount_total)}
                  currencyCode={currency}
                />
              )}
              <div className="mt-1 border-t border-gray-100 pt-1">
                <AmountRow
                  label="결제금액"
                  value={order.total}
                  currencyCode={currency}
                  emphasize
                />
              </div>
            </section>

            {/* 배송지 */}
            {address && (
              <section>
                <h3 className="mb-1.5 text-sm font-semibold text-gray-800">
                  배송지
                </h3>
                <div className="space-y-0.5 rounded-md bg-gray-50 p-3 text-sm text-gray-700">
                  <div>
                    {[address.first_name, address.last_name]
                      .filter(Boolean)
                      .join(' ') || '-'}
                  </div>
                  {address.phone && <div>{address.phone}</div>}
                  <div>
                    {[
                      address.address_1,
                      address.address_2,
                      address.city,
                      address.province,
                      address.postal_code,
                    ]
                      .filter(Boolean)
                      .join(' ') || '-'}
                  </div>
                </div>
              </section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 주문번호별 테이블: 한 주문당 한 행 */
function ByOrderTable({
  orders,
  customer,
  totalCount,
  onSelect,
}: {
  orders: AdminOrder[];
  customer: OrdererInfo | undefined;
  totalCount: number;
  onSelect: (orderId: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[1040px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-36">주문일(결제일)</TableHead>
            <TableHead className="w-40">주문번호</TableHead>
            <TableHead className="w-44">주문자</TableHead>
            <TableHead className="min-w-[160px]">상품명</TableHead>
            <TableHead className="text-right">총 상품구매금액</TableHead>
            <TableHead className="text-right">총 실결제금액</TableHead>
            <TableHead className="w-24">결제수단</TableHead>
            <TableHead className="w-24">결제상태</TableHead>
            <TableHead className="w-14 text-center">미배송</TableHead>
            <TableHead className="w-14 text-center">배송중</TableHead>
            <TableHead className="w-16 text-center">배송완료</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => {
            const buckets = fulfillmentBuckets(order);
            const channel = order.sales_channel?.name;
            return (
              <TableRow
                key={order.id}
                className="cursor-pointer align-top"
                onClick={() => onSelect(order.id)}
              >
                <TableCell className="whitespace-nowrap text-xs text-gray-600">
                  {formatDateTime(order.created_at)}
                </TableCell>
                <TableCell className="text-xs">
                  {channel && (
                    <div className="text-gray-400">{channel}</div>
                  )}
                  <div className="font-medium text-indigo-600">
                    {order.display_id}
                  </div>
                </TableCell>
                <TableCell>
                  <OrdererCell customer={customer} totalCount={totalCount} />
                </TableCell>
                <TableCell className="text-sm text-gray-800">
                  {summarizeItemNames(order)}
                </TableCell>
                <TableCell className="text-right text-gray-700">
                  {formatCurrency(
                    order.item_subtotal ?? order.subtotal,
                    order.currency_code
                  )}
                </TableCell>
                <TableCell className="text-right font-medium text-gray-900">
                  {formatCurrency(order.total, order.currency_code)}
                </TableCell>
                <TableCell>
                  <PaymentMethods order={order} />
                </TableCell>
                <TableCell>
                  <Badge variant={paymentBadgeVariant(order.payment_status)}>
                    {paymentStatusLabel(order.payment_status)}
                  </Badge>
                </TableCell>
                <TableCell className="text-center text-gray-700">
                  {buckets.pending}
                </TableCell>
                <TableCell className="text-center text-gray-700">
                  {buckets.shipping}
                </TableCell>
                <TableCell className="text-center text-gray-700">
                  {buckets.delivered}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** 품목주문별 테이블: 한 라인 아이템당 한 행 (주문 단위 셀은 rowSpan) */
function ByItemTable({
  orders,
  customer,
  onSelect,
}: {
  orders: AdminOrder[];
  customer: OrdererInfo | undefined;
  onSelect: (orderId: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[1100px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-36">주문일(결제일)</TableHead>
            <TableHead className="w-44">품목별 주문번호</TableHead>
            <TableHead className="w-44">주문자</TableHead>
            <TableHead className="min-w-[220px]">상품명/옵션</TableHead>
            <TableHead className="w-14 text-center">수량</TableHead>
            <TableHead className="text-right">상품구매금액</TableHead>
            <TableHead className="text-right">총 실결제금액</TableHead>
            <TableHead className="w-24">결제수단</TableHead>
            <TableHead className="w-24">결제상태</TableHead>
            <TableHead className="w-24">주문상태</TableHead>
            <TableHead className="w-24">운송장정보</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.flatMap((order) => {
            const items = order.items ?? [];
            const span = Math.max(1, items.length);
            return items.map((item, index) => (
              <TableRow
                key={item.id}
                className="cursor-pointer align-top"
                onClick={() => onSelect(order.id)}
              >
                {index === 0 && (
                  <TableCell
                    rowSpan={span}
                    className="whitespace-nowrap text-xs text-gray-600"
                  >
                    {formatDateTime(order.created_at)}
                  </TableCell>
                )}
                <TableCell className="text-xs font-medium text-indigo-600">
                  {itemOrderNo(order.display_id, index)}
                </TableCell>
                {index === 0 && (
                  <TableCell rowSpan={span}>
                    <OrdererCell customer={customer} />
                  </TableCell>
                )}
                <TableCell>
                  <div className="flex gap-2">
                    {resolvePublicFileUrl(item.thumbnail) ? (
                      // 외부 CDN(메두사) 이미지라 next/image 대신 img 사용
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={resolvePublicFileUrl(item.thumbnail) ?? ''}
                        alt={item.title}
                        className="size-10 shrink-0 rounded border object-cover"
                      />
                    ) : (
                      <div className="flex size-10 shrink-0 items-center justify-center rounded border bg-gray-50 text-gray-300">
                        <Package className="size-4" />
                      </div>
                    )}
                    <div className="min-w-0 text-xs leading-tight">
                      <div className="text-gray-900">
                        {item.product_title ?? item.title}
                      </div>
                      {item.variant_sku && (
                        <div className="text-gray-400">({item.variant_sku})</div>
                      )}
                      {item.variant_title && (
                        <div className="text-gray-500">
                          옵션 : {item.variant_title}
                        </div>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-center text-gray-700">
                  {item.quantity}
                </TableCell>
                <TableCell className="text-right text-gray-700">
                  {formatCurrency(item.total, order.currency_code)}
                </TableCell>
                {index === 0 && (
                  <TableCell
                    rowSpan={span}
                    className="text-right font-medium text-gray-900"
                  >
                    {formatCurrency(order.total, order.currency_code)}
                  </TableCell>
                )}
                {index === 0 && (
                  <TableCell rowSpan={span}>
                    <PaymentMethods order={order} />
                  </TableCell>
                )}
                {index === 0 && (
                  <TableCell rowSpan={span}>
                    <Badge variant={paymentBadgeVariant(order.payment_status)}>
                      {paymentStatusLabel(order.payment_status)}
                    </Badge>
                  </TableCell>
                )}
                <TableCell className="text-xs text-gray-600">
                  {itemStatusLabel(item)}
                </TableCell>
                <TableCell className="text-xs text-gray-400">-</TableCell>
              </TableRow>
            ));
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** 페이지 번호 윈도우 계산 (현재 페이지 주변 최대 5개) */
function getPageWindow(current: number, totalPages: number): number[] {
  const span = 5;
  let start = Math.max(1, current - Math.floor(span / 2));
  const end = Math.min(totalPages, start + span - 1);
  start = Math.max(1, end - span + 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export function OrdersTab({ customerId }: { customerId: string }) {
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('by-order');

  // 기간 필터: 입력값(draft)과 적용값(applied) 분리. 프리셋 클릭은 즉시 적용.
  const [preset, setPreset] = useState<DatePreset>('all');
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');

  // 상태 필터 (클라이언트). 'all' = 전체
  const [paymentStatus, setPaymentStatus] = useState<string>(ALL);
  const [fulfillmentStatus, setFulfillmentStatus] = useState<string>(ALL);

  const [page, setPage] = useState(1);

  const { data: customer, isLoading: isCustomerLoading } =
    useCustomerById(customerId);
  const email = customer?.email ?? '';

  const { data: medusaCustomerRes, isLoading: isMedusaCustomerLoading } =
    useMedusaCustomerByEmail(email);
  const medusaCustomerId = medusaCustomerRes?.customers?.[0]?.id;

  const {
    data: ordersRes,
    isLoading: isOrdersLoading,
    isFetching: isOrdersFetching,
    isError: isOrdersError,
  } = useMedusaOrdersByCustomerId(medusaCustomerId, {
    limit: FETCH_LIMIT,
    createdAtGte: toIsoStart(appliedFrom),
    createdAtLte: toIsoEnd(appliedTo),
  });

  const fetchedOrders: AdminOrder[] = useMemo(
    () => ordersRes?.orders ?? [],
    [ordersRes]
  );
  const matchedCount = ordersRes?.count ?? fetchedOrders.length;
  const hasMoreThanFetched = matchedCount > fetchedOrders.length;

  // 상태 필터는 서버가 지원하지 않아 클라이언트에서 적용
  const filteredOrders = useMemo(() => {
    return fetchedOrders.filter((o) => {
      if (paymentStatus !== ALL && o.payment_status !== paymentStatus) {
        return false;
      }
      if (
        fulfillmentStatus !== ALL &&
        o.fulfillment_status !== fulfillmentStatus
      ) {
        return false;
      }
      return true;
    });
  }, [fetchedOrders, paymentStatus, fulfillmentStatus]);

  const total = filteredOrders.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedOrders = filteredOrders.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

  const isLoading =
    isCustomerLoading ||
    (!!email && (isMedusaCustomerLoading || isOrdersLoading));
  const isError =
    !!email && !isLoading && (isOrdersError || !medusaCustomerId);

  // ── 핸들러 ──
  const applyPreset = (key: DatePreset) => {
    const range = computeDateRange(key);
    setPreset(key);
    setDraftFrom(range?.from ?? '');
    setDraftTo(range?.to ?? '');
    setAppliedFrom(range?.from ?? '');
    setAppliedTo(range?.to ?? '');
    setPage(1);
  };

  const handleSearch = () => {
    setPreset('custom');
    setAppliedFrom(draftFrom);
    setAppliedTo(draftTo);
    setPage(1);
  };

  const handleReset = () => {
    setPreset('all');
    setDraftFrom('');
    setDraftTo('');
    setAppliedFrom('');
    setAppliedTo('');
    setPaymentStatus(ALL);
    setFulfillmentStatus(ALL);
    setPage(1);
  };

  const handleStatusChange = (setter: (v: string) => void, value: string) => {
    setter(value);
    setPage(1);
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800">
        <Package className="size-4 text-indigo-500" />
        주문내역
        {!isLoading && !isError && (
          <span className="text-xs font-normal text-gray-500">
            총 {total.toLocaleString()}건
          </span>
        )}
      </div>

      {/* ── 필터 바 ── */}
      <div className="mb-4 space-y-3 rounded-md border border-gray-100 bg-gray-50 p-3">
        {/* 기간 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="w-12 shrink-0 text-xs font-medium text-gray-500">
            기간
          </span>
          <div className="flex flex-wrap gap-1">
            {PRESET_BUTTONS.map((p) => (
              <Button
                key={p.value}
                type="button"
                size="sm"
                variant={preset === p.value ? 'default' : 'outline'}
                className="h-7 px-2.5 text-xs"
                onClick={() => applyPreset(p.value as DatePreset)}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={draftFrom}
              max={draftTo || undefined}
              onChange={(e) => setDraftFrom(e.target.value)}
              className="h-7 w-[140px] text-xs"
            />
            <span className="text-xs text-gray-400">~</span>
            <Input
              type="date"
              value={draftTo}
              min={draftFrom || undefined}
              onChange={(e) => setDraftTo(e.target.value)}
              className="h-7 w-[140px] text-xs"
            />
          </div>
        </div>

        {/* 상태 + 액션 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="w-12 shrink-0 text-xs font-medium text-gray-500">
            상태
          </span>
          <Select
            value={paymentStatus}
            onValueChange={(v) => handleStatusChange(setPaymentStatus, v)}
          >
            <SelectTrigger className="h-7 w-[130px] text-xs">
              <SelectValue placeholder="결제상태" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>결제상태 전체</SelectItem>
              {PAYMENT_STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={fulfillmentStatus}
            onValueChange={(v) => handleStatusChange(setFulfillmentStatus, v)}
          >
            <SelectTrigger className="h-7 w-[130px] text-xs">
              <SelectValue placeholder="배송상태" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>배송상태 전체</SelectItem>
              {FULFILLMENT_STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto flex gap-1.5">
            <Button
              type="button"
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={handleSearch}
            >
              검색
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-3 text-xs"
              onClick={handleReset}
            >
              초기화
            </Button>
          </div>
        </div>
      </div>

      {/* ── 뷰 전환 탭 ── */}
      <Tabs
        value={viewMode}
        onValueChange={(v) => setViewMode(v as ViewMode)}
        className="mb-3"
      >
        <TabsList>
          <TabsTrigger value="by-order">주문번호별</TabsTrigger>
          <TabsTrigger value="by-item">품목주문별</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* 너무 많은 주문이 기간에 걸린 경우 안내 */}
      {hasMoreThanFetched && !isLoading && !isError && (
        <p className="mb-2 text-xs text-amber-600">
          이 기간에 주문이 {matchedCount.toLocaleString()}건 있어 최신{' '}
          {FETCH_LIMIT}건만 표시합니다. 기간을 좁혀 조회해주세요.
        </p>
      )}

      {/* ── 목록 ── */}
      {isLoading ? (
        <div className="space-y-2 py-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : isError ? (
        <div className="py-8 text-center text-sm text-red-400">
          주문 내역을 불러오지 못했습니다.
        </div>
      ) : total === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400">
          {isOrdersFetching ? '불러오는 중…' : '조회된 주문이 없습니다.'}
        </div>
      ) : (
        <>
          {viewMode === 'by-order' ? (
            <ByOrderTable
              orders={pagedOrders}
              customer={customer}
              totalCount={matchedCount}
              onSelect={setSelectedOrderId}
            />
          ) : (
            <ByItemTable
              orders={pagedOrders}
              customer={customer}
              onSelect={setSelectedOrderId}
            />
          )}

          {/* ── 페이지네이션 ── */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-1">
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="size-7"
                disabled={safePage <= 1}
                onClick={() => setPage(safePage - 1)}
                aria-label="이전 페이지"
              >
                <ChevronLeft className="size-4" />
              </Button>
              {getPageWindow(safePage, totalPages).map((p) => (
                <Button
                  key={p}
                  type="button"
                  size="icon"
                  variant={p === safePage ? 'default' : 'outline'}
                  className={cn('size-7 text-xs')}
                  onClick={() => setPage(p)}
                >
                  {p}
                </Button>
              ))}
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="size-7"
                disabled={safePage >= totalPages}
                onClick={() => setPage(safePage + 1)}
                aria-label="다음 페이지"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </>
      )}

      <OrderDetailDialog
        orderId={selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
      />
    </section>
  );
}
