'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { DeliveryProfilesTable } from '../components/table';

export default function DeliveryProfilesTemplate() {
  return (
    <Container>
      <Header
        title="배송 프로필"
        subtitle="발송인·출고지·반품지·택배 계약번호 묶음입니다. 사입·위탁 SKU 는 프로필이 있어야 만들 수 있고, 출고 계획 확정은 상자의 모든 SKU 가 같은 프로필이기를 요구합니다."
      />
      <DeliveryProfilesTable />
    </Container>
  );
}
