'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { InventoryStatusTable } from '../components/table';

export default function InventoryStatusTemplate() {
  return (
    <Container>
      <Header
        title="재고 현황"
        subtitle="상품별 재고·미발송·부족을 보고, 카드를 눌러 걸러 봅니다."
      />
      <InventoryStatusTable />
    </Container>
  );
}
