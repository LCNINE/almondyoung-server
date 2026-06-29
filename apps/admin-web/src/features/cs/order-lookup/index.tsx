'use client';

// src/features/cs/order-lookup/index.tsx
// CS 주문조회 화면. 주문 이력 목록의 주문번호 링크(/cs?orderId=...)로 진입한다.
// 주문 라인에는 옵션 정보가 없고 PIM Variant 에만 있으므로, variantId 로 batch 조회해 옵션을 표시한다.

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { orders } from '@/lib/api/domains';
import { useVariantsBatch } from '@/lib/services/products';

// orderItemStatus enum → 한글 라벨
const LINE_STATUS_LABEL: Record<string, string> = {
  pending: '매칭대기',
  matched: '매칭완료',
  stock_deducted: '재고차감(출고가능)',
  stock_unavailable: '재고부족',
  cancelled: '취소',
};

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
  let obj: any = sa;
  if (typeof sa === 'string') {
    try {
      obj = JSON.parse(sa);
    } catch {
      return { address: sa };
    }
  }
  if (typeof obj !== 'object') return {};
  const address = `${obj.roadAddress ?? obj.address ?? ''} ${obj.detailAddress ?? ''}`.trim();
  return {
    recipient: obj.recipientName ?? obj.recipient ?? undefined,
    phone: obj.phone ?? undefined,
    address: address || undefined,
    personalCustomsCode: obj.personalCustomsCode ?? obj.customsCode ?? '',
  };
}

/** salesChannel 은 객체({name,type}) 또는 문자열로 올 수 있다. */
function formatChannel(c: unknown): string {
  if (!c) return '-';
  if (typeof c === 'string') return c;
  if (typeof c === 'object') {
    const o = c as any;
    return o.name ?? o.type ?? '-';
  }
  return '-';
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

  const lines: any[] = useMemo(() => order?.lines ?? [], [order]);

  const variantIds = useMemo(
    () =>
      Array.from(
        new Set(
          lines.map((l) => l.variantId).filter((v): v is string => !!v)
        )
      ),
    [lines]
  );
  const { data: variantMap } = useVariantsBatch(variantIds);

  if (!orderId) {
    return (
      <div className="rounded-md border border-gray-200 bg-white p-6 text-sm text-gray-600">
        주문 ID가 없습니다. 주문 이력에서 주문번호를 눌러 진입해 주세요.
      </div>
    );
  }

  if (isLoading) {
    return <div className="p-4 text-sm text-gray-500">주문 정보를 불러오는 중…</div>;
  }

  if (error || !order) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        주문을 찾을 수 없습니다. (orderId: {orderId})
      </div>
    );
  }

  const addr = parseAddress(order.shippingAddress);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold text-gray-900">CS 주문조회</h1>
        <span className="text-sm text-gray-500">
          {order.channelOrderId ?? orderNoParam}
        </span>
      </div>

      {/* 주문 헤더 */}
      <section className="rounded-md border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">주문 정보</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="주문번호" value={order.channelOrderId ?? orderNoParam} />
          <Field label="판매채널" value={formatChannel(order.salesChannel)} />
          <Field label="주문상태" value={order.status} />
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

      {/* 고객/배송 정보 */}
      <section className="rounded-md border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">고객 / 배송</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="주문자" value={order.customerName} />
          <Field label="이메일" value={order.customerEmail} />
          <Field
            label="연락처"
            value={addr.phone ?? order.customerPhone}
          />
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
              <th className="p-2">상태</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={6} className="p-4 text-center text-gray-400">
                  상품 정보가 없습니다.
                </td>
              </tr>
            )}
            {lines.map((line, idx) => {
              const variant = line.variantId
                ? variantMap?.get(line.variantId)
                : undefined;
              const option = variant?.optionLabel;
              return (
                <tr
                  key={line.id ?? idx}
                  className="border-b border-gray-100 last:border-0"
                >
                  <td className="p-2 font-medium text-gray-900">
                    {line.productName ??
                      variant?.masterName ??
                      line.variantId ??
                      '-'}
                  </td>
                  <td className="p-2 text-gray-600">{option ?? '단일상품'}</td>
                  <td className="p-2 text-right">{line.quantity ?? '-'}</td>
                  <td className="p-2 text-right">{formatWon(line.unitPrice)}</td>
                  <td className="p-2 text-right">{formatWon(line.totalPrice)}</td>
                  <td className="p-2 text-gray-600">
                    {LINE_STATUS_LABEL[line.status as string] ??
                      line.status ??
                      '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
