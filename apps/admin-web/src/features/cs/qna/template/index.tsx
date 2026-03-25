'use client';

import { QnaTable } from '../components/table';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';

export default function QnaListTemplate() {
  return (
    <Container className="divide-y-0">
      <Header title="Q&A 관리" />
      <QnaTable />
    </Container>
  );
}
