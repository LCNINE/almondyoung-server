'use client';

import { CustomerTable } from '../components/table';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';

export default function CustomerListTemplate() {
  return (
    <Container className="divide-y-0">
      <Header title="고객 관리" />
      <CustomerTable />
    </Container>
  );
}
