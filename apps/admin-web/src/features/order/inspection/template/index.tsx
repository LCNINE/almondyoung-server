'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { InspectionSessionStarter } from '../components/inspection-session-starter';

export default function InspectionTemplate() {
  return (
    <Container className="divide-y-0">
      <Header
        title="검수 관리"
        subtitle="inspection-ready shipment의 PACKING custody와 source를 확인하고 검수합니다."
      />
      <div className="flex flex-col gap-4 p-4">
        <InspectionSessionStarter />
      </div>
    </Container>
  );
}
