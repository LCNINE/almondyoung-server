'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { MyDraftsTable } from '../components/table';

export default function MyDraftsTemplate() {
  return (
    <Container className="divide-y-0">
      <Header
        title="작성중인 상품"
        subtitle="내가 만든 임시저장 상품을 이어서 편집할 수 있습니다."
      />
      <MyDraftsTable />
    </Container>
  );
}
