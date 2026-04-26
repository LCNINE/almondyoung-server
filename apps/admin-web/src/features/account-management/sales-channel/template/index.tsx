'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import { SalesChannelTable } from '../components/table';
import { SalesChannelForm } from '../components/form-dialog';
import type { ChannelDto } from '@/lib/types/dto/products';

export default function SalesChannelTemplate() {
  const [editingChannel, setEditingChannel] = useState<ChannelDto | null>(null);
  const [showForm, setShowForm] = useState(false);

  const handleEdit = (channel: ChannelDto) => {
    setEditingChannel(channel);
    setShowForm(true);
  };

  const handleNew = () => {
    setEditingChannel(null);
    setShowForm(true);
  };

  const handleFormSuccess = () => {
    setShowForm(false);
    setEditingChannel(null);
    toast.success(editingChannel ? '판매처가 수정되었습니다.' : '판매처가 생성되었습니다.');
  };

  return (
    <>
      <Container className="divide-y-0">
        <Header
          title="판매처 관리"
          subtitle="채널별 판매처를 관리하고 등록하세요"
          right={
            <Button size="sm" onClick={handleNew}>
              판매처 등록
            </Button>
          }
        />
        <SalesChannelTable onEdit={handleEdit} />
      </Container>

      <SalesChannelForm
        open={showForm}
        onOpenChange={setShowForm}
        onSuccess={handleFormSuccess}
        editingChannel={editingChannel}
      />
    </>
  );
}
