'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CanOpen } from '@/components/auth/can';
import { RefundTable } from '../components/refund-table';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';

export default function RefundListTemplate() {
  // 다른 화면의 «환불 내역 보기»는 결제 하나로 거른 채 온다 — 거른 것이 화면 필터에는 없어 따로 알린다
  const intentId = useSearchParams().get('intentId');
  return (
    <Container>
      <Header title="환불 내역" />
      {intentId && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-blue-50 px-6 py-2 text-sm text-blue-900">
          <span>한 결제의 환불만 보고 있습니다.</span>
          <CanOpen screen="/payments">
            <Link
              href={`/payments/${encodeURIComponent(intentId)}`}
              className="font-medium text-blue-700 hover:underline"
            >
              결제 보기
            </Link>
          </CanOpen>
          <Link
            href="/payments/refunds"
            className="font-medium text-blue-700 hover:underline"
          >
            전체 환불 보기
          </Link>
        </div>
      )}
      <RefundTable />
    </Container>
  );
}
