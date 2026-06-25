'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { OwnershipsTable } from '../components/table';

export default function OwnershipsTemplate() {
  return (
    <Container className="divide-y-0">
      <Header
        title="디지털 사용권"
        subtitle="디지털 자산 사용권(ownership)을 고객·자산·주문 단위로 조회하고, 수동 부여·회수·재활성화합니다."
      />
      <OwnershipsTable />
    </Container>
  );
}
