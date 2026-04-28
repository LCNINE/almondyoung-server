'use client';

import { BillingHistoryFilterBox } from '../components/filter-box';
import { BillingHistoryTable } from '../components/table';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';

export function BillingHistoryTemplate() {
  return (
    <Container className="divide-y-0">
      <Header
        title="결제 내역 조회"
        subtitle="멤버십 정기결제 내역을 조회합니다."
      />
      <BillingHistoryFilterBox />
      <BillingHistoryTable />
    </Container>
  );
}
