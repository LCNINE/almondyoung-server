'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PendingApprovalTable } from '../components/pending-approval-table';
import { AuditLogTable } from '../components/audit-log-table';

export default function AuditTemplate() {
  return (
    <Container className="divide-y-0">
      <Header
        title="감사 이력 / 승인 관리"
        subtitle="상품 승인 요청을 처리하고 변경 이력을 확인합니다."
      />
      <Tabs defaultValue="pending" className="px-4 pb-4">
        <TabsList>
          <TabsTrigger value="pending">승인 대기</TabsTrigger>
          <TabsTrigger value="audit">감사 로그</TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="mt-4">
          <PendingApprovalTable />
        </TabsContent>
        <TabsContent value="audit" className="mt-4">
          <AuditLogTable />
        </TabsContent>
      </Tabs>
    </Container>
  );
}
