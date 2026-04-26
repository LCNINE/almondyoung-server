'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { ProductsListTable } from '../components/table';

export default function ProductsListTemplate() {
  return (
    <Container className="divide-y-0">
      <Header
        title="상품 목록"
        subtitle="상품을 관리하고 상태를 변경할 수 있습니다."
      />
      <ProductsListTable />
    </Container>
  );
}
