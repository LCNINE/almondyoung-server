'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { OrderStatusSection } from '../components/status-section';
import FilterBox from '../components/filter-box';
import OrderTable from '../components/table';
import { OrderHistoryFilterProvider } from '../contexts/filter.context';

export default function OrderHistoryTemplate() {
  return (
    <div className="space-y-2">
      <Container>
        <OrderStatusSection />
      </Container>

      <Container className="divide-y-0">
        <Header title="주문 내역" />
        <OrderHistoryFilterProvider>
          <FilterBox />
          <OrderTable />
        </OrderHistoryFilterProvider>
      </Container>
    </div>
  );
}
