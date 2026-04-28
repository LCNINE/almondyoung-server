'use client';

import { CancellationsFilterBox } from '../components/filter-box';
import { CancellationsTable } from '../components/table';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';

export function CancellationsTemplate() {
  return (
    <Container className="divide-y-0">
      <Header
        title="해지 내역 조회"
        subtitle="멤버십을 해지한 회원 목록을 조회합니다."
      />
      <CancellationsFilterBox />
      <CancellationsTable />
    </Container>
  );
}
