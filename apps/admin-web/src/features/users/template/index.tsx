'use client';

import { UserTable } from '../components/table';
import { Container } from '@/components/admin-ui-experimental/container/container';
import { Header } from '@/components/admin-ui-experimental/header/header';

export default function UserListTemplate() {
  return (
    <Container className='divide-y-0'>
      <Header title="계정 관리"/>
      <UserTable />
    </Container>
  );
}
