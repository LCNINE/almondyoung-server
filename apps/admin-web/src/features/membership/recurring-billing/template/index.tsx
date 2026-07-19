'use client';

import { useRecurringBillingOverview } from '@/lib/services/membership';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { RecurringBillingSummaryCards } from '../components/summary-cards';
import { RecurringBillingFilterBox } from '../components/filter-box';
import { RecurringBillingTable } from '../components/table';

export default function RecurringBillingTemplate() {
  const { data: overview, isError, isLoading, refetch } = useRecurringBillingOverview();

  return (
    <Container className="divide-y-0">
      <Header
        title="정기결제 관리"
        subtitle="자동이체 결제수단 심사, 월 정기 출금, 출금 결과 대기 상태를 확인합니다."
      />
      {isError ? (
        // 조회 실패를 "0건 정상"으로 오인하지 않도록 명시적으로 표시한다.
        <div className="my-3 flex items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <span className="text-destructive">요약 지표를 불러오지 못했습니다. 아래 카운트는 정확하지 않을 수 있습니다.</span>
          <button
            type="button"
            className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
            onClick={() => refetch()}
          >
            다시 시도
          </button>
        </div>
      ) : null}
      {overview ? (
        <RecurringBillingSummaryCards overview={overview} />
      ) : isLoading ? (
        <p className="py-3 text-sm text-muted-foreground">요약 지표를 불러오는 중...</p>
      ) : null}
      <RecurringBillingFilterBox />
      <RecurringBillingTable />
    </Container>
  );
}
