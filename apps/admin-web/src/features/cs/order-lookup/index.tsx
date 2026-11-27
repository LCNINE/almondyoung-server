'use client';

// src/features/cs/order-lookup/index.tsx
// CS 주문조회 화면. 주문 이력 목록의 주문번호 링크(/cs?orderId=...)로 진입한다.
// 주문 라인에는 옵션 정보가 없고 PIM Variant 에만 있으므로, variantId 로 batch 조회해 옵션을 표시한다.

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { orders } from '@/lib/api/domains';
import { CanOpen } from '@/components/auth/can';
import { siteLabel } from '@/lib/api/domains/sales-channel/vocabulary';
import type { OrderKeywordType, SalesOrderDto } from '@/lib/types/dto/orders';
import { useVariantsBatch } from '@/lib/services/products';
import { formatCustomerOrderNo } from '@/features/order/history/utils/customer-order-no';
import { AlmondDesignPrintCard } from '@/features/orders/almond-design/almond-design-print-card';
import {
  shipmentPhaseLabel,
  toShipmentPhase,
} from '@/lib/api/domains/orders/shipment-phase.shape';
import { useMedusaOrderById } from '@/lib/services/medusa-customers/queries';
import { paymentStatusLabel } from '@/features/customers/detail-window/lib/order-labels';
import { OrderFulfillmentSection } from './order-fulfillment-section';
import { salesOrderStatusLabel } from './order-status-label';

function formatWon(v?: number | null): string {
  if (v === undefined || v === null) return '-';
  return `${v.toLocaleString()}원`;
}

/** shippingAddress 는 타입상 string 이지만 런타임은 JSON(string|object) 일 수 있어 방어적으로 파싱한다. */
function parseAddress(sa: unknown): {
  recipient?: string;
  phone?: string;
  address?: string;
  personalCustomsCode?: string;
} {
  if (!sa) return {};
  let source: unknown = sa;
  if (typeof sa === 'string') {
    try {
      source = JSON.parse(sa) as unknown;
    } catch {
      return { address: sa };
    }
  }
  if (typeof source !== 'object' || source === null || Array.isArray(source))
    return {};
  const obj = source as Record<string, unknown>;
  const string = (key: string) =>
    typeof obj[key] === 'string' ? obj[key] : undefined;
  const address =
    `${string('roadAddress') ?? string('address') ?? ''} ${string('detailAddress') ?? ''}`.trim();
  return {
    recipient: string('recipientName') ?? string('recipient'),
    phone: string('phone'),
    address: address || undefined,
    personalCustomsCode: string('personalCustomsCode') ?? string('customsCode'),
  };
}

/** salesChannel 은 객체({name,type}) 또는 문자열로 올 수 있다. */
function formatChannel(c: unknown): string {
  if (!c) return '-';
  if (typeof c === 'string') return siteLabel(c);
  if (typeof c === 'object') {
    const o = c as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name : o.type;
    return siteLabel(typeof name === 'string' ? name : '-');
  }
  return '-';
}

const SEARCH_TYPES: Array<{ value: OrderKeywordType; label: string }> = [
  { value: 'orderNo', label: '주문번호' },
  { value: 'receiver', label: '받는 분' },
  { value: 'phone', label: '연락처' },
];

export function CsOrderSearch() {
  const [keywordType, setKeywordType] = useState<OrderKeywordType>('orderNo');
  const [keyword, setKeyword] = useState('');
  const [search, setSearch] = useState<{
    type: OrderKeywordType;
    keyword: string;
  } | null>(null);
  const [page, setPage] = useState(0);

  const results = useQuery({
    queryKey: ['cs', 'order-search', search, page],
    queryFn: () =>
      orders.salesOrders.getSalesOrders({
        keyword: search!.keyword,
        keywordType: search!.type,
        limit: 20,
        offset: page * 20,
      }),
    enabled: search !== null,
  });

  return (
    <section
      className="rounded-md border border-gray-200 bg-white p-4"
      aria-label="주문 찾기"
    >
      <h2 className="mb-3 text-sm font-semibold text-gray-700">주문 찾기</h2>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = keyword.trim();
          if (!trimmed) return;
          setPage(0);
          setSearch({ type: keywordType, keyword: trimmed });
        }}
      >
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          찾을 기준
          <select
            className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900"
            value={keywordType}
            onChange={(event) =>
              setKeywordType(event.target.value as OrderKeywordType)
            }
          >
            {SEARCH_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-gray-600">
          검색어
          <input
            className="h-9 rounded-md border border-gray-300 px-3 text-sm text-gray-900"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="주문번호, 받는 분 또는 연락처"
          />
        </label>
        <button
          type="submit"
          disabled={!keyword.trim()}
          className="h-9 rounded-md bg-primary px-4 text-sm text-white disabled:opacity-50"
        >
          찾기
        </button>
      </form>

      {results.isPending && search && (
        <p className="mt-3 text-sm text-gray-500">주문을 찾는 중…</p>
      )}
      {results.isError && (
        <div className="mt-3 flex items-center gap-2 text-sm text-red-700">
          주문을 찾지 못했어요.
          <button
            type="button"
            className="underline"
            onClick={() => void results.refetch()}
          >
            다시 시도
          </button>
        </div>
      )}
      {results.data && !results.isError && (
        <div className="mt-3 space-y-2 text-sm">
          <p className="text-gray-600">
            검색 결과 {results.data.total.toLocaleString('ko-KR')}건
          </p>
          {results.data.data.length === 0 && (
            <p className="text-gray-500">맞는 주문이 없어요.</p>
          )}
          <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
            {results.data.data.map((order: SalesOrderDto) => {
              const orderNo = formatCustomerOrderNo(
                order.displayOrderNo,
                order.orderDate ? String(order.orderDate) : undefined,
                order.channelOrderId
              );
              const address = parseAddress(order.shippingAddress);
              return (
                <li key={order.id}>
                  <Link
                    href={`/cs?orderId=${encodeURIComponent(order.id)}&orderNo=${encodeURIComponent(orderNo)}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 hover:bg-gray-50"
                  >
                    <span className="font-medium text-primary">{orderNo}</span>
                    <span>
                      {address.recipient ??
                        order.customerName ??
                        '받는 분 없음'}
                    </span>
                    <span className="text-gray-600">
                      {address.phone ?? order.customerPhone ?? ''}
                    </span>
                    <span className="ml-auto text-gray-500">
                      {formatChannel(order.salesChannel)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {results.data.total > 20 && (
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                className="underline disabled:text-gray-400"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                이전
              </button>
              <span>{page + 1}쪽</span>
              <button
                type="button"
                className="underline disabled:text-gray-400"
                disabled={(page + 1) * 20 >= results.data.total}
                onClick={() => setPage(page + 1)}
              >
                다음
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value ?? '-'}</span>
    </div>
  );
}

export default function CsOrderLookup() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get('orderId') ?? '';
  const orderNoParam = searchParams.get('orderNo') ?? '';

  const {
    data: order,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['cs', 'sales-order', orderId],
    queryFn: () => orders.salesOrders.getSalesOrder(orderId),
    enabled: !!orderId,
  });

  const lines = useMemo(() => order?.lines ?? [], [order]);

  const variantIds = useMemo(
    () =>
      Array.from(
        new Set(lines.map((l) => l.variantId).filter((v): v is string => !!v))
      ),
    [lines]
  );
  const { data: variantMap } = useVariantsBatch(variantIds);
  const medusaOrderId = order?.channelOrderId?.startsWith('order_')
    ? order.channelOrderId
    : undefined;
  const { data: medusaOrder } = useMedusaOrderById(medusaOrderId);
  const almondDesignByItem = useMemo(
    () =>
      new Map(
        (medusaOrder?.order?.items ?? []).flatMap((item) =>
          typeof item.metadata?.almond_design_id === 'string'
            ? [[item.id, item.metadata.almond_design_id] as const]
            : []
        )
      ),
    [medusaOrder]
  );

  if (!orderId) return <CsOrderSearch />;

  if (isLoading) {
    return (
      <div className="p-4 text-sm text-gray-500">주문 정보를 불러오는 중…</div>
    );
  }

  if (error || !order) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        주문을 찾을 수 없습니다. (orderId: {orderId})
      </div>
    );
  }

  const addr = parseAddress(order.shippingAddress);
  const customerOrderNo =
    formatCustomerOrderNo(
      order.displayOrderNo,
      order.orderDate ? String(order.orderDate) : undefined,
      order.channelOrderId
    ) || orderNoParam;
  const linkedOrderNo =
    order.channelOrderId || order.displayOrderNo || customerOrderNo;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold text-gray-900">CS 주문조회</h1>
        <span className="text-sm text-gray-500">{customerOrderNo}</span>
      </div>

      {/* 주문 헤더 */}
      <section className="rounded-md border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">주문 정보</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {/* CS 는 고객이 불러주는 번호로 대조하는 화면이라 내부 ID 가 아니라 고객 주문번호를 앞에 둔다. */}
          <Field label="주문번호" value={customerOrderNo} />
          <Field label="판매처 주문번호" value={order.channelOrderId ?? '-'} />
          <Field label="판매채널" value={formatChannel(order.salesChannel)} />
          <Field label="주문상태" value={salesOrderStatusLabel(order.status)} />
          {medusaOrder?.order?.payment_status && (
            <Field
              label="결제"
              value={paymentStatusLabel(medusaOrder.order.payment_status)}
            />
          )}
          {/* 단계는 core 가 정한다. 옛 응답이면 «모름» — 빈 칸 대신 칸을 감춘다. */}
          {shipmentPhaseLabel(toShipmentPhase(order.shipmentPhase)) && (
            <Field
              label="출고 단계"
              value={shipmentPhaseLabel(toShipmentPhase(order.shipmentPhase))}
            />
          )}
          <Field
            label="주문일시"
            value={
              order.orderDate
                ? new Date(order.orderDate).toLocaleString('ko-KR')
                : '-'
            }
          />
          <Field label="주문금액" value={formatWon(order.totalAmount)} />
          <Field label="배송비" value={formatWon(order.shippingFee)} />
        </div>
      </section>

      <OrderFulfillmentSection
        orderId={order.id}
        orderNo={customerOrderNo}
        fulfillmentOrder={order.fulfillmentOrder}
        lineRouteCounts={order.lineRouteCounts}
      />

      <section className="rounded-md border border-gray-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">주문 처리</h2>
        <div className="flex flex-wrap gap-3 text-sm">
          <CanOpen screen="/order/history">
            <Link
              className="text-primary underline"
              href={`/order/history?orderNo=${encodeURIComponent(linkedOrderNo)}`}
            >
              주문내역에서 가능한 조치 확인
            </Link>
          </CanOpen>
          <CanOpen screen="/cs/return-exchange">
            <Link
              className="text-primary underline"
              href={`/cs/return-exchange?q=${encodeURIComponent(linkedOrderNo)}`}
            >
              반품·교환 진행 내역
            </Link>
          </CanOpen>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          취소·메모·반품 접수는 주문 상태와 권한에 따라 표시됩니다.
        </p>
      </section>

      {/* 고객/배송 정보 */}
      <section className="rounded-md border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">
          고객 / 배송
        </h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="주문자" value={order.customerName} />
          <Field label="이메일" value={order.customerEmail} />
          <Field label="연락처" value={addr.phone ?? order.customerPhone} />
          <Field label="수령인" value={addr.recipient ?? order.customerName} />
          <Field label="배송지" value={addr.address} />
          {addr.personalCustomsCode && (
            <Field label="통관부호" value={addr.personalCustomsCode} />
          )}
        </div>
      </section>

      {/* 주문 상품 + 옵션 */}
      <section className="rounded-md border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">
          주문 상품 ({lines.length})
        </h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
              <th className="p-2">상품명</th>
              <th className="p-2">옵션</th>
              <th className="p-2 text-right">수량</th>
              <th className="p-2 text-right">단가</th>
              <th className="p-2 text-right">금액</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-gray-400">
                  상품 정보가 없습니다.
                </td>
              </tr>
            )}
            {lines.map((line, idx) => {
              const lineId =
                'id' in line && typeof line.id === 'string'
                  ? line.id
                  : undefined;
              const channelItemId =
                'channelOrderItemId' in line &&
                typeof line.channelOrderItemId === 'string'
                  ? line.channelOrderItemId
                  : undefined;
              const variant = line.variantId
                ? variantMap?.get(line.variantId)
                : undefined;
              const option = variant?.optionLabel;
              // core 라인 값이 출고 안내와 같은 근거다. 옛 응답이면 Medusa 주문에서 찾는다
              const almondDesignId =
                line.almondDesignId ??
                almondDesignByItem.get(channelItemId ?? '');
              return (
                <Fragment key={lineId ?? idx}>
                  <tr className="border-b border-gray-100 last:border-0">
                    <td className="p-2 font-medium text-gray-900">
                      {line.productName ??
                        variant?.masterName ??
                        line.variantId ??
                        '-'}
                    </td>
                    <td className="p-2 text-gray-600">
                      {option ?? '단일상품'}
                    </td>
                    <td className="p-2 text-right">{line.quantity ?? '-'}</td>
                    <td className="p-2 text-right">
                      {formatWon(line.unitPrice)}
                    </td>
                    <td className="p-2 text-right">
                      {formatWon(line.totalPrice)}
                    </td>
                  </tr>
                  {almondDesignId && (
                    <tr className="border-b border-gray-100">
                      <td colSpan={5} className="px-2 pb-3">
                        <AlmondDesignPrintCard
                          designId={almondDesignId}
                          lineId={lineId}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
