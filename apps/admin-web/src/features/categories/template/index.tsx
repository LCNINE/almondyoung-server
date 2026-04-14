'use client';

import { CategoryTable } from '../components/table';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';

export default function CategoryListTemplate() {
  return (
    <Container className="divide-y-0">
      <Header title="카테고리 관리" />
      <CategoryTable />
    </Container>
  );
}
