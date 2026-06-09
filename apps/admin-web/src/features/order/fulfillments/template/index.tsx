'use client';

import { FulfillmentsTable } from '../components/table';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';

export default function FulfillmentsListTemplate() {
  return (
    <Container className="divide-y-0">
      <Header title="출고주문" />
      <FulfillmentsTable />
    </Container>
  );
}
