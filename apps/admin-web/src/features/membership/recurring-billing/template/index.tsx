'use client';

import { useRecurringBillingOverview } from '@/lib/services/membership';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { RecurringBillingSummaryCards } from '../components/summary-cards';
import { RecurringBillingFilterBox } from '../components/filter-box';
import { RecurringBillingTable } from '../components/table';

export default function RecurringBillingTemplate() {
  const { data: overview } = useRecurringBillingOverview();

  return (
    <Container className="divide-y-0">
      <Header
        title="정기결제 관리"
        subtitle="자동이체 결제수단 심사, 월 정기 출금, 출금 결과 대기 상태를 확인합니다."
      />
      <RecurringBillingSummaryCards
        overview={
          overview ?? {
            needsAction: 0,
            memberPending: 0,
            memberFailed: 0,
            withdrawalRequested: 0,
            settlementPending: 0,
            withdrawalFailed: 0,
          }
        }
      />
      <RecurringBillingFilterBox />
      <RecurringBillingTable />
    </Container>
  );
}
