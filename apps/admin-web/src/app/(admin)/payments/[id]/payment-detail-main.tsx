'use client';

import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  usePaymentIntentDetail,
  useStateTransitions,
} from '@/lib/services/wallet';
import { walletQueryKeys } from '@/lib/services/wallet/query-keys';
import { walletApi } from '@/lib/api/domains/wallet';
import { StatusBadgeCell } from '@/components/table/table-cells/wallet/status-badge-cell';
import { AmountCell } from '@/components/table/table-cells/wallet/amount-cell';
import Link from 'next/link';
import type {
  ChargeDto,
  RefundDto,
  StateTransitionDto,
  PaymentIntentItemDto,
  OrderDiscountDto,
} from '@/lib/types/dto/wallet';
import { Empty } from '@/components/admin-ui-experimental/common/empty';

function KVRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-3 p-3">
      <div className="text-sm font-medium text-gray-500">{label}</div>
      <div className="col-span-2 text-sm">{children}</div>
    </div>
  );
}

function BasicInfoContent({ intentId }: { intentId: string }) {
  const { data } = usePaymentIntentDetail(intentId);

  return (
    <div>
      <KVRow label="ID">
        <span className="font-mono text-xs">{data.id}</span>
      </KVRow>
      <KVRow label="상태">
        <StatusBadgeCell value={data.displayStatus ?? data.status} type="intent" />
      </KVRow>
      <KVRow label="결제 금액">
        <AmountCell
          value={data.payableAmount}
          currency={data.currency}
          className="text-left!"
        />
      </KVRow>
      <KVRow label="통화">{data.currency}</KVRow>
      <KVRow label="사용자">
        {data.userId ? (
          <Link
            href={`/users/${data.userId}`}
            className="font-mono text-xs text-blue-600 hover:underline"
          >
            {data.userId}
          </Link>
        ) : (
          '-'
        )}
      </KVRow>
      <KVRow label="생성일">
        {new Date(data.createdAt).toLocaleString('ko-KR')}
      </KVRow>
      <KVRow label="만료일">
        {new Date(data.expiresAt).toLocaleString('ko-KR')}
      </KVRow>
      {data.metadata && Object.keys(data.metadata).length > 0 && (
        <KVRow label="메타데이터">
          <pre className="p-2 overflow-auto text-xs rounded bg-gray-50 max-h-32">
            {JSON.stringify(data.metadata, null, 2)}
          </pre>
        </KVRow>
      )}
    </div>
  );
}

function BasicInfo({ intentId }: { intentId: string }) {
  return (
    <Container className="divide-y">
      <Header title="결제 기본 정보" />
      <Suspense
        fallback={
          <div className="flex justify-center p-8">
            <Spinner />
          </div>
        }
      >
        <BasicInfoContent intentId={intentId} />
      </Suspense>
    </Container>
  );
}

function ItemsTableContent({ intentId }: { intentId: string }) {
  const { data } = usePaymentIntentDetail(intentId);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-gray-50">
            <th className="px-4 py-2 font-medium text-left">상품명</th>
            <th className="px-4 py-2 font-medium text-right">단가</th>
            <th className="px-4 py-2 font-medium text-right">수량</th>
            <th className="px-4 py-2 font-medium text-right">결제금액</th>
          </tr>
        </thead>
        <tbody>
          {data.items.length === 0 ? (
            <tr>
              <td colSpan={4}>
                <Empty message="주문 항목 없음" />
              </td>
            </tr>
          ) : (
            data.items.map((item: PaymentIntentItemDto) => (
              <tr key={item.id} className="border-b">
                <td className="px-4 py-2">{item.name}</td>
                <td className="px-4 py-2 font-mono text-right">
                  {item.unitPrice.toLocaleString('ko-KR')}
                </td>
                <td className="px-4 py-2 text-right">{item.quantity}</td>
                <td className="px-4 py-2 font-mono text-right">
                  {item.payableAmount.toLocaleString('ko-KR')}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function ItemsTable({ intentId }: { intentId: string }) {
  return (
    <Container className="divide-y">
      <Header title="주문 항목" />
      <Suspense
        fallback={
          <div className="flex justify-center p-8">
            <Spinner />
          </div>
        }
      >
        <ItemsTableContent intentId={intentId} />
      </Suspense>
    </Container>
  );
}

function OrderDiscountsSectionContent({ intentId }: { intentId: string }) {
  const { data } = usePaymentIntentDetail(intentId);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-gray-50">
            <th className="px-4 py-2 font-medium text-left">할인명</th>
            <th className="px-4 py-2 font-medium text-left">유형</th>
            <th className="px-4 py-2 font-medium text-right">금액</th>
          </tr>
        </thead>
        <tbody>
          {data.orderDiscounts.length === 0 ? (
            <tr>
              <td colSpan={3}>
                <Empty message="주문 할인 없음" />
              </td>
            </tr>
          ) : (
            data.orderDiscounts.map((d: OrderDiscountDto) => (
              <tr key={d.id} className="border-b">
                <td className="px-4 py-2">{d.name ?? '-'}</td>
                <td className="px-4 py-2">{d.kind}</td>
                <td className="px-4 py-2 font-mono text-right">
                  {d.amount.toLocaleString('ko-KR')}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function OrderDiscountsSection({ intentId }: { intentId: string }) {
  return (
    <Container className="divide-y">
      <Header title="주문 할인" />
      <Suspense
        fallback={
          <div className="flex justify-center p-8">
            <Spinner />
          </div>
        }
      >
        <OrderDiscountsSectionContent intentId={intentId} />
      </Suspense>
    </Container>
  );
}

function ChargesTableContent({ intentId }: { intentId: string }) {
  const { data } = usePaymentIntentDetail(intentId);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-gray-50">
            <th className="px-4 py-2 font-medium text-left">ID</th>
            <th className="px-4 py-2 font-medium text-left">유형</th>
            <th className="px-4 py-2 font-medium text-right">금액</th>
            <th className="px-4 py-2 font-medium text-left">상태</th>
            <th className="px-4 py-2 font-medium text-left">생성일</th>
          </tr>
        </thead>
        <tbody>
          {data.charges.length === 0 ? (
            <tr>
              <td colSpan={5}>
                <Empty message="Charge 없음" />
              </td>
            </tr>
          ) : (
            data.charges.map((c: ChargeDto) => (
              <tr key={c.id} className="border-b">
                <td className="px-4 py-2 font-mono text-xs">
                  {c.id.slice(0, 8)}...
                </td>
                <td className="px-4 py-2">{c.operation}</td>
                <td className="px-4 py-2 font-mono text-right">
                  {c.amount.toLocaleString('ko-KR')}
                </td>
                <td className="px-4 py-2">
                  <StatusBadgeCell value={c.status} type="charge" />
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground">
                  {new Date(c.createdAt).toLocaleString('ko-KR')}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function ChargesTable({ intentId }: { intentId: string }) {
  return (
    <Container className="divide-y">
      <Header title="Charges" />
      <Suspense
        fallback={
          <div className="flex justify-center p-8">
            <Spinner />
          </div>
        }
      >
        <ChargesTableContent intentId={intentId} />
      </Suspense>
    </Container>
  );
}

function RefundConfirmButton({ refundId, intentId, amount, currency }: { refundId: string; intentId: string; amount: number; currency: string }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => walletApi.confirmRefund(refundId),
    onSuccess: () => {
      toast.success('환불 완료 처리되었습니다.');
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: walletQueryKeys.intentDetail(intentId) });
      queryClient.invalidateQueries({ queryKey: walletQueryKeys.stateTransitions(intentId) });
      queryClient.invalidateQueries({ queryKey: walletQueryKeys.refunds() });
    },
    onError: () => toast.error('완료 처리 중 오류가 발생했습니다.'),
  });

  return (
    <>
      <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => setOpen(true)}>
        완료 처리
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>수동 환불 완료 처리</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>환불 금액 <span className="font-semibold">{amount.toLocaleString('ko-KR')} {currency}</span>을 실제로 고객 계좌에 송금했습니까?</p>
            <p className="text-amber-700 bg-amber-50 rounded p-2 text-xs">실제 송금이 완료된 경우에만 처리하세요. 이 작업은 되돌릴 수 없습니다.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={mutation.isPending}>취소</Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending ? '처리 중...' : '송금 완료 확인'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RefundsTableContent({ intentId }: { intentId: string }) {
  const { data } = usePaymentIntentDetail(intentId);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-gray-50">
            <th className="px-4 py-2 font-medium text-left">ID</th>
            <th className="px-4 py-2 font-medium text-right">금액</th>
            <th className="px-4 py-2 font-medium text-left">상태</th>
            <th className="px-4 py-2 font-medium text-left">사유</th>
            <th className="px-4 py-2 font-medium text-left">생성일</th>
            <th className="px-4 py-2 font-medium text-left">액션</th>
          </tr>
        </thead>
        <tbody>
          {data.refunds.length === 0 ? (
            <tr>
              <td colSpan={6}>
                <Empty message="환불 없음" />
              </td>
            </tr>
          ) : (
            data.refunds.map((r: RefundDto) => (
              <tr key={r.id} className="border-b">
                <td className="px-4 py-2 font-mono text-xs">
                  {r.id.slice(0, 8)}...
                </td>
                <td className="px-4 py-2 font-mono text-right">
                  {r.amount.toLocaleString('ko-KR')}
                </td>
                <td className="px-4 py-2">
                  <StatusBadgeCell value={r.status} type="refund" />
                </td>
                <td className="px-4 py-2 text-xs">{r.reasonCode ?? '-'}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">
                  {new Date(r.createdAt).toLocaleString('ko-KR')}
                </td>
                <td className="px-4 py-2">
                  {r.manualConfirmable && (
                    <RefundConfirmButton refundId={r.id} intentId={intentId} amount={r.amount} currency={r.currency} />
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      {data.refunds.some((r: RefundDto) => r.manualConfirmable) && (
        <p className="px-4 py-2 text-xs text-amber-600">수동 송금 대기 중인 환불이 있습니다. 실제 송금 완료 후 “완료 처리” 버튼을 눌러주세요.</p>
      )}
    </div>
  );
}

function RefundsTable({ intentId }: { intentId: string }) {
  return (
    <Container className="divide-y">
      <Header title="환불" />
      <Suspense
        fallback={
          <div className="flex justify-center p-8">
            <Spinner />
          </div>
        }
      >
        <RefundsTableContent intentId={intentId} />
      </Suspense>
    </Container>
  );
}

function StateTransitionTimelineContent({ intentId }: { intentId: string }) {
  const { data: transitions } = useStateTransitions(intentId);

  if (transitions.length === 0) {
    return <Empty message="상태 변경 이력 없음" />;
  }

  return (
    <div className="p-4 space-y-3">
      {transitions.map((t: StateTransitionDto) => (
        <div key={t.id} className="flex items-start gap-3 text-sm">
          <div className="text-xs w-36 shrink-0 text-muted-foreground">
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
  );
}

function StateTransitionTimeline({ intentId }: { intentId: string }) {
  return (
    <Container className="divide-y">
      <Header title="상태 변경 이력" />
      <Suspense
        fallback={
          <div className="flex justify-center p-8">
            <Spinner />
          </div>
        }
      >
        <StateTransitionTimelineContent intentId={intentId} />
      </Suspense>
    </Container>
  );
}

export function PaymentDetailMain({ intentId }: { intentId: string }) {
  return (
    <div className="flex flex-col w-full gap-y-3">
      <BasicInfo intentId={intentId} />
      <ItemsTable intentId={intentId} />
      <OrderDiscountsSection intentId={intentId} />
      <ChargesTable intentId={intentId} />
      <RefundsTable intentId={intentId} />
      <StateTransitionTimeline intentId={intentId} />
    </div>
  );
}
