'use client';

import { Suspense } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { OutboundBatchesTable } from '../components/table';

export default function OutboundBatchesTemplate() {
  return (
    <Container className="divide-y-0">
      <Header
        title="출고 배치 관리"
        subtitle="피킹 배치를 생성하고 FO를 할당하여 출고 흐름을 관리합니다."
      />
      <Suspense fallback={<p className="py-8 text-center text-sm text-muted-foreground">로딩 중...</p>}>
        <OutboundBatchesTable />
      </Suspense>
    </Container>
  );
}
