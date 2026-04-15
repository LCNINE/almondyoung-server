'use client';

import { MembershipMemberTable } from '../components/table';
import { MembershipMemberFilterBox } from '../components/filter-box';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';

export default function MembershipMemberListTemplate() {
  return (
    <Container className="divide-y-0">
      <Header
        title="멤버십 회원 조회"
        subtitle="멤버십을 한 번이라도 구독했던 회원의 정보를 모두 조회할 수 있습니다."
      />
      <MembershipMemberFilterBox />
      <MembershipMemberTable />
    </Container>
  );
}
