'use client';

import { useSearchParams } from 'next/navigation';
import { useRecurringBillingOverview } from '@/lib/services/membership';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { RecurringBillingSummaryCards } from '../components/summary-cards';
import { RecurringBillingFinancePanel } from '../components/finance-panel';
import { RecurringBillingFilterBox } from '../components/filter-box';
import { RecurringBillingTable } from '../components/table';

export default function RecurringBillingTemplate() {
  const { data: overview, isError, isLoading, refetch } = useRecurringBillingOverview();
  // 필터 상자는 입력 상태를 처음 한 번 URL 에서 읽는다. 카드·탭으로 URL 이 바뀌면 다시 만들어 화면과 주소를 맞춘다.
  const filterKey = useSearchParams().toString();

  return (
    <Container>
      <Header
        title="정기결제 관리"
        subtitle="멤버십 정기결제로 걷은 돈과 못 걷은 돈, 오늘 손봐야 할 일을 한 화면에서 봅니다."
      />
      <RecurringBillingFinancePanel />
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
      <RecurringBillingFilterBox key={filterKey} />
      <RecurringBillingTable />
    </Container>
  );
}
