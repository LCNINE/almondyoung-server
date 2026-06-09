'use client';

import { Suspense } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { FulfillmentsTable } from '../components/table';

export default function FulfillmentsTemplate() {
  return (
    <Container className="divide-y-0">
      <Header
        title="풀필먼트 오더"
        subtitle="FO 상태·예약·배송 현황을 조회하고 후속 작업 화면으로 이동합니다."
      />
      <Suspense fallback={<p className="py-8 text-center text-sm text-muted-foreground">로딩 중...</p>}>
        <FulfillmentsTable />
      </Suspense>
    </Container>
  );
}
