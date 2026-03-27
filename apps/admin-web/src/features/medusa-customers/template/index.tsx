'use client';

import { MedusaCustomerTable } from '../components/table';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';

export default function MedusaCustomerListTemplate() {
  return (
    <Container className="divide-y-0">
      <Header title="메두사 고객 관리" subtitle="Medusa 서버의 고객 정보를 조회합니다" />
      <MedusaCustomerTable />
    </Container>
  );
}
