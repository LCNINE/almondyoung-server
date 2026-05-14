'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { NoticesTable } from '../components/table';

export default function NoticesTemplate() {
  return (
    <Container className="divide-y-0">
      <Header
        title="공지사항"
        subtitle="고객에게 노출되는 공지사항을 관리합니다."
      />
      <NoticesTable />
    </Container>
  );
}
