'use client';

import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { VariantsMatchingTable } from '../components/table';

export default function VariantsMatchingTemplate() {
  return (
    <Container className="divide-y-0">
      <Header
        title="옵션 매칭"
        subtitle="variant 단위 매칭 레코드를 관리합니다."
      />
      <VariantsMatchingTable />
    </Container>
  );
}
