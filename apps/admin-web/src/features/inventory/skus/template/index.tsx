'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { SkusTable } from '../components/table';

export default function SkusTemplate() {
  return (
    <Container className="divide-y-0">
      <Header title="SKU 마스터 관리" subtitle="SKU 목록 조회, 생성, 편집 및 바코드 관리." />
      <SkusTable />
    </Container>
  );
}
