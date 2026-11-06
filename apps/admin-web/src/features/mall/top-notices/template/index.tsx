'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { TopNoticesTable } from '../components/table';

export default function TopNoticesTemplate() {
  return (
    <Container>
      <Header
        title="상단 공지 띠"
        subtitle="스토어프론트 헤더 위에 한 줄로 흐르는 공지를 관리합니다."
      />
      <TopNoticesTable />
    </Container>
  );
}
