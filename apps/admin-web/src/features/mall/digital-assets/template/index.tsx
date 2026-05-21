'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { DigitalAssetsTable } from '../components/table';

export default function DigitalAssetsTemplate() {
  return (
    <Container className="divide-y-0">
      <Header
        title="디지털 자산"
        subtitle="디지털 fulfillment 용 자산(파일) 을 관리합니다. variant 매칭과 파일 버전 이력을 관리할 수 있습니다."
      />
      <DigitalAssetsTable />
    </Container>
  );
}
