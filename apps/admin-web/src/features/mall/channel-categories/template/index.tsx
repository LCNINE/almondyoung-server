'use client';

import { useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { useCreateChannelCategory } from '@/lib/services/products';
import { ChannelCategoriesTable } from '../components/channel-categories-table';
import { ChannelCategoryFormDialog } from '../components/channel-category-form-dialog';

export default function ChannelCategoriesTemplate() {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <Container>
      <Header
        title="채널 카테고리"
        subtitle="판매 채널을 그룹화하는 카테고리를 관리합니다. 연결된 채널이 있는 카테고리는 삭제할 수 없습니다."
        right={
          <Can run={useCreateChannelCategory}>
            <Button onClick={() => setCreateOpen(true)}>카테고리 생성</Button>
          </Can>
        }
      />

      <ChannelCategoriesTable />

      <ChannelCategoryFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </Container>
  );
}
