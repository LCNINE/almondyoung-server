'use client';

import { PaymentIntentTable } from '../components/table';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';

export default function PaymentListTemplate() {
  return (
    <Container className="divide-y-0">
      <Header title="결제 내역" />
      <PaymentIntentTable />
    </Container>
  );
}
