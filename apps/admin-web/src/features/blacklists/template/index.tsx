'use client';

import { BlacklistTable } from '../components/table';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';

export default function BlacklistListTemplate() {
  return (
    <Container className="divide-y-0">
      <Header title="블랙리스트 관리" />
      <BlacklistTable />
    </Container>
  );
}
