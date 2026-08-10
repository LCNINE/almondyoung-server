'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { PopupsTable } from '../components/table';

export default function PopupsTemplate() {
  return (
    <Container>
      <Header
        title="팝업"
        subtitle="스토어프론트 진입 시 뜨는 팝업 공지를 관리합니다."
      />
      <PopupsTable />
    </Container>
  );
}
