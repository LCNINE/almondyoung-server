'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { StocktakingTable } from '../components/table';

export default function StocktakingTemplate() {
  return (
    <Container className="divide-y-0">
      <Header
        title="재고 실사"
        subtitle="창고별 재고 실사 세션을 생성하고 진행합니다. 차이 발생 시 재고 조정이 자동 생성됩니다."
      />
      <StocktakingTable />
    </Container>
  );
}
