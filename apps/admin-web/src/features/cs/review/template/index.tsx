'use client';

import { ReviewTable } from '../components/table';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';

export default function ReviewListTemplate() {
  return (
    <Container className="divide-y-0">
      <Header title="리뷰 관리" />
      <ReviewTable />
    </Container>
  );
}
