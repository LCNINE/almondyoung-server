'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { InventoryStatusTable } from '../components/table';

export default function InventoryStatusTemplate() {
  return (
    <Container className="divide-y-0">
      <Header title="재고 현황" subtitle="SKU·창고별 재고 요약 및 이력을 관리합니다." />
      <InventoryStatusTable />
    </Container>
  );
}
