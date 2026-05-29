'use client';

import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { VariantsMatchingTable } from '../components/table';

export default function VariantsMatchingTemplate() {
  return (
    <Container className="divide-y-0">
      <Header
        title="옵션 상품매칭"
        subtitle="variant 단위 SKU 구성 매칭과 재고상품 비매칭 전략을 관리합니다."
      />
      <VariantsMatchingTable />
    </Container>
  );
}
