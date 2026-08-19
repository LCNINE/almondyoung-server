'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { AuditLogTable } from '../components/audit-log-table';

export default function AuditTemplate() {
  return (
    <Container>
      <Header
        title="감사 이력"
        subtitle="상품 변경 이력을 확인합니다."
      />
      <div className="px-4 pb-4 pt-4">
        <AuditLogTable />
      </div>
    </Container>
  );
}
