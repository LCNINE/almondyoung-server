'use client';

import { Suspense } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Spinner } from '@/components/ui/spinner';
import { usePaymentIntentDetail, useStateTransitions } from '@/lib/services/wallet';
import { StatusBadgeCell } from '@/components/table/table-cells/wallet/status-badge-cell';
import { AmountCell } from '@/components/table/table-cells/wallet/amount-cell';
import Link from 'next/link';
import type { ChargeDto, RefundDto, StateTransitionDto, PaymentIntentItemDto, OrderDiscountDto } from '@/lib/types/dto/wallet';

function KVRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 p-3">
      <div className="text-sm font-medium text-gray-500">{label}</div>
      <div className="col-span-2 text-sm">{children}</div>
    </div>
  );
}

function BasicInfo({ intentId }: { intentId: string }) {
  const { data } = usePaymentIntentDetail(intentId);

  return (
    <Container className="divide-y">
      <Header title="기본 정보" />
      <div>
        <KVRow label="ID"><span className="font-mono text-xs">{data.id}</span></KVRow>
        <KVRow label="상태"><StatusBadgeCell value={data.status} type="intent" /></KVRow>
        <KVRow label="결제 금액"><AmountCell value={data.payableAmount} currency={data.currency} /></KVRow>
        <KVRow label="통화">{data.currency}</KVRow>
        <KVRow label="사용자">
          {data.userId ? (
            <Link href={`/users/${data.userId}`} className="text-blue-600 hover:underline font-mono text-xs">
              {data.userId}
            </Link>
          ) : '-'}
        </KVRow>
        <KVRow label="생성일">{new Date(data.createdAt).toLocaleString('ko-KR')}</KVRow>
        <KVRow label="만료일">{new Date(data.expiresAt).toLocaleString('ko-KR')}</KVRow>
        {data.metadata && Object.keys(data.metadata).length > 0 && (
          <KVRow label="메타데이터">
            <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto max-h-32">
              {JSON.stringify(data.metadata, null, 2)}
            </pre>
          </KVRow>
        )}
      </div>
    </Container>
  );
}

function ItemsTable({ intentId }: { intentId: string }) {
  const { data } = usePaymentIntentDetail(intentId);
  if (data.items.length === 0) return null;

  return (
    <Container className="divide-y">
      <Header title="주문 항목" />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="px-4 py-2 text-left font-medium">상품명</th>
              <th className="px-4 py-2 text-right font-medium">단가</th>
              <th className="px-4 py-2 text-right font-medium">수량</th>
              <th className="px-4 py-2 text-right font-medium">결제금액</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item: PaymentIntentItemDto) => (
              <tr key={item.id} className="border-b">
                <td className="px-4 py-2">{item.name}</td>
                <td className="px-4 py-2 text-right font-mono">{item.unitPrice.toLocaleString('ko-KR')}</td>
                <td className="px-4 py-2 text-right">{item.quantity}</td>
                <td className="px-4 py-2 text-right font-mono">{item.payableAmount.toLocaleString('ko-KR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Container>
  );
}

function OrderDiscountsSection({ intentId }: { intentId: string }) {
  const { data } = usePaymentIntentDetail(intentId);
  if (data.orderDiscounts.length === 0) return null;

  return (
    <Container className="divide-y">
      <Header title="주문 할인" />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="px-4 py-2 text-left font-medium">할인명</th>
              <th className="px-4 py-2 text-left font-medium">유형</th>
              <th className="px-4 py-2 text-right font-medium">금액</th>
            </tr>
          </thead>
          <tbody>
            {data.orderDiscounts.map((d: OrderDiscountDto) => (
              <tr key={d.id} className="border-b">
                <td className="px-4 py-2">{d.name ?? '-'}</td>
                <td className="px-4 py-2">{d.kind}</td>
                <td className="px-4 py-2 text-right font-mono">{d.amount.toLocaleString('ko-KR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Container>
  );
}

function ChargesTable({ intentId }: { intentId: string }) {
  const { data } = usePaymentIntentDetail(intentId);
  if (data.charges.length === 0) return null;

  return (
    <Container className="divide-y">
      <Header title="Charges" />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="px-4 py-2 text-left font-medium">ID</th>
              <th className="px-4 py-2 text-left font-medium">유형</th>
              <th className="px-4 py-2 text-right font-medium">금액</th>
              <th className="px-4 py-2 text-left font-medium">상태</th>
              <th className="px-4 py-2 text-left font-medium">생성일</th>
            </tr>
          </thead>
          <tbody>
            {data.charges.map((c: ChargeDto) => (
              <tr key={c.id} className="border-b">
                <td className="px-4 py-2 font-mono text-xs">{c.id.slice(0, 8)}...</td>
                <td className="px-4 py-2">{c.operation}</td>
                <td className="px-4 py-2 text-right font-mono">{c.amount.toLocaleString('ko-KR')}</td>
                <td className="px-4 py-2"><StatusBadgeCell value={c.status} type="charge" /></td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleString('ko-KR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Container>
  );
}

function RefundsTable({ intentId }: { intentId: string }) {
  const { data } = usePaymentIntentDetail(intentId);
  if (data.refunds.length === 0) return null;

  return (
    <Container className="divide-y">
      <Header title="환불" />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="px-4 py-2 text-left font-medium">ID</th>
              <th className="px-4 py-2 text-right font-medium">금액</th>
              <th className="px-4 py-2 text-left font-medium">상태</th>
              <th className="px-4 py-2 text-left font-medium">사유</th>
              <th className="px-4 py-2 text-left font-medium">생성일</th>
            </tr>
          </thead>
          <tbody>
            {data.refunds.map((r: RefundDto) => (
              <tr key={r.id} className="border-b">
                <td className="px-4 py-2 font-mono text-xs">{r.id.slice(0, 8)}...</td>
                <td className="px-4 py-2 text-right font-mono">{r.amount.toLocaleString('ko-KR')}</td>
                <td className="px-4 py-2"><StatusBadgeCell value={r.status} type="refund" /></td>
                <td className="px-4 py-2 text-xs">{r.reasonCode ?? '-'}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString('ko-KR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Container>
  );
}

function StateTransitionTimeline({ intentId }: { intentId: string }) {
  const { data: transitions } = useStateTransitions(intentId);
  if (transitions.length === 0) return null;

  return (
    <Container className="divide-y">
      <Header title="상태 변경 이력" />
      <div className="p-4 space-y-3">
        {transitions.map((t: StateTransitionDto) => (
          <div key={t.id} className="flex items-start gap-3 text-sm">
            <div className="w-36 shrink-0 text-xs text-muted-foreground">
              {new Date(t.occurredAt).toLocaleString('ko-KR')}
            </div>
            <div>
              <span className="font-medium">[{t.entityType}]</span>{' '}
              <span className="text-muted-foreground">{t.previousStatus}</span>
              {' → '}
              <span className="font-medium">{t.newStatus}</span>
            </div>
          </div>
        ))}
      </div>
    </Container>
  );
}

function FallbackSpinner() {
  return (
    <div className="flex justify-center p-8">
      <Spinner />
    </div>
  );
}

export function PaymentDetailMain({ intentId }: { intentId: string }) {
  return (
    <div className="flex w-full flex-col gap-y-3">
      <Suspense fallback={<FallbackSpinner />}>
        <BasicInfo intentId={intentId} />
      </Suspense>
      <Suspense fallback={<FallbackSpinner />}>
        <ItemsTable intentId={intentId} />
      </Suspense>
      <Suspense fallback={<FallbackSpinner />}>
        <OrderDiscountsSection intentId={intentId} />
      </Suspense>
      <Suspense fallback={<FallbackSpinner />}>
        <ChargesTable intentId={intentId} />
      </Suspense>
      <Suspense fallback={<FallbackSpinner />}>
        <RefundsTable intentId={intentId} />
      </Suspense>
      <Suspense fallback={<FallbackSpinner />}>
        <StateTransitionTimeline intentId={intentId} />
      </Suspense>
    </div>
  );
}
