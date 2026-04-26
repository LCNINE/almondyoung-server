'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { TransferJobsTable } from '../components/table';

export default function TransferJobsTemplate() {
  return (
    <Container className="divide-y-0">
      <Header title="재고 이동" subtitle="창고 간 · 창고 내 재고 이동 작업을 관리합니다." />
      <TransferJobsTable />
    </Container>
  );
}
