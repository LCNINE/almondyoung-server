'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { BannerGroupsTable } from '../components/table';

export default function BannerGroupsTemplate() {
  return (
    <Container className="divide-y-0">
      <Header
        title="배너 그룹"
        subtitle="배너 그룹을 관리합니다. 그룹 상세에서 소속 배너를 편집할 수 있습니다."
      />
      <BannerGroupsTable />
    </Container>
  );
}
