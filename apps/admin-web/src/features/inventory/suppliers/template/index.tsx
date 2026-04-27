'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { SuppliersTable } from '../components/table';

export default function SuppliersTemplate() {
  return (
    <Container className="divide-y-0">
      <Header
        title="공급처 관리"
        subtitle="상품 공급처를 등록하고 관리합니다."
      />
      <SuppliersTable />
    </Container>
  );
}
