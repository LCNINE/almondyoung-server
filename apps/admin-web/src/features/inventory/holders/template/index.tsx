'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { HoldersTable } from '../components/table';

export default function HoldersTemplate() {
  return (
    <Container className="divide-y-0">
      <Header title="재고 소유자 관리" subtitle="재고 소유자를 등록하고 관리합니다." />
      <HoldersTable />
    </Container>
  );
}
