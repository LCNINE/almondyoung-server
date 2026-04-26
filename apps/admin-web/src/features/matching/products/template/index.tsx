'use client';

import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { ProductsMatchingTable } from '../components/table';

export default function ProductsMatchingTemplate() {
  return (
    <Container className="divide-y-0">
      <Header
        title="상품 매칭"
        subtitle="마스터(상품)별 variant ↔ SKU 매핑 룰을 관리합니다."
      />
      <ProductsMatchingTable />
    </Container>
  );
}
