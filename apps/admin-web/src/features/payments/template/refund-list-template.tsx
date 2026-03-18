'use client';

import { RefundTable } from '../components/refund-table';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';

export default function RefundListTemplate() {
  return (
    <Container className="divide-y-0">
      <Header title="환불 내역" />
      <RefundTable />
    </Container>
  );
}
