'use client';

import { useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { useNotice } from '@/lib/services/products';
import { NoticeForm } from '../components/notice-form';
import { NoticeView } from '../components/notice-view';

type Props = {
  id: string;
};

export default function NoticeDetailTemplate({ id }: Props) {
  const { data: notice, isLoading } = useNotice(id);
  const [editing, setEditing] = useState(false);

  if (isLoading) {
    return (
      <Container>
        <div className="p-6 text-sm text-muted-foreground">불러오는 중...</div>
      </Container>
    );
  }

  if (!notice) {
    return (
      <Container>
        <div className="p-6 text-sm text-muted-foreground">
          공지사항을 찾을 수 없습니다.
        </div>
      </Container>
    );
  }

  return (
    <Container>
      <Header
        title={notice.title}
        subtitle={`분류: ${notice.category}${notice.badge ? ` · 뱃지: ${notice.badge}` : ''}`}
      />
      {editing ? (
        <NoticeForm
          notice={notice}
          onCancel={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      ) : (
        <NoticeView notice={notice} onEdit={() => setEditing(true)} />
      )}
    </Container>
  );
}
