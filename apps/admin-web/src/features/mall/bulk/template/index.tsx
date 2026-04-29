'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { BulkTable } from '../components/table';

export default function BulkTemplate() {
  return (
    <Container className="divide-y-0">
      <Header
        title="일괄 작업"
        subtitle="여러 상품을 선택해 상태, 가격, 브랜드를 한 번에 변경하거나 삭제·복원할 수 있습니다."
      />
      <BulkTable />
    </Container>
  );
}
