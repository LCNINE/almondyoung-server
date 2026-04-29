'use client';

import { useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import { ReturnsTable } from '../components/returns-table';
import { CreateReturnDialog } from '../components/create-return-dialog';

export default function ReturnsTemplate() {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <Container className="divide-y-0">
      <Header
        title="회수/반품 처리"
        subtitle="반품 접수, 입고 처리, QC 검수, 재입고/폐기를 관리합니다."
        right={
          <Button onClick={() => setCreateOpen(true)}>회수 등록</Button>
        }
      />

      <ReturnsTable />

      <CreateReturnDialog open={createOpen} onOpenChange={setCreateOpen} />
    </Container>
  );
}
