'use client';

import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { VariantsMatchingTable } from '../../variants/components/table';

export default function LegacyIgnoredMatchingTemplate() {
  return (
    <Container className="divide-y-0">
      <Header
        title="레거시 상품매칭 감사"
        subtitle="ignored 상태로 남은 상품매칭을 확인하고 전략 미결정 또는 재고상품 비매칭으로 정리합니다."
      />
      <VariantsMatchingTable fixedStatus="ignored" />
    </Container>
  );
}
