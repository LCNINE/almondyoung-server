'use client';

import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { ProductsMatchingTable } from '../components/table';

export default function ProductsMatchingTemplate() {
  return (
    <Container className="divide-y-0">
      <Header
        title="상품매칭 전략"
        subtitle="마스터(상품)별 SKU 구성 매칭과 재고상품 비매칭 전략을 관리합니다."
      />
      <ProductsMatchingTable />
    </Container>
  );
}
