'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { InspectionSessionStarter } from '../components/inspection-session-starter';
import { QualityMetricsCard } from '../components/quality-metrics-card';

export default function InspectionTemplate() {
  return (
    <Container className="divide-y-0">
      <Header
        title="검수 관리"
        subtitle="풀필먼트 주문 단위로 검수 세션을 생성하고 상품 상태를 확인합니다."
      />
      <div className="flex flex-col gap-4 p-4">
        <QualityMetricsCard />
        <InspectionSessionStarter />
      </div>
    </Container>
  );
}
