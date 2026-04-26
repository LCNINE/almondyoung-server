'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { SkuGroupsTable } from '../components/table';

export default function SkuGroupsTemplate() {
  return (
    <Container className="divide-y-0">
      <Header title="SKU 그룹 관리" subtitle="SKU를 그룹으로 묶어 일괄 관리합니다." />
      <SkuGroupsTable />
    </Container>
  );
}
