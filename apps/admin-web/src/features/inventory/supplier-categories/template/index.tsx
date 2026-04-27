'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { SupplierCategoriesTable } from '../components/table';

export default function SupplierCategoriesTemplate() {
  return (
    <Container className="divide-y-0">
      <Header
        title="공급처 분류"
        subtitle="공급처를 묶어서 관리할 분류를 등록합니다."
      />
      <SupplierCategoriesTable />
    </Container>
  );
}
