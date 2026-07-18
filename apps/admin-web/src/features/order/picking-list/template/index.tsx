'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { V2PickingWorkspace } from '../components/v2-picking-workspace';

export default function PickingListTemplate() {
  return (
    <Container className="divide-y-0">
      <Header
        title="V2 피킹 실행"
        subtitle="batch, plan, session, work item과 실제 custody를 기준으로 전략별 피킹을 실행합니다."
      />
      <V2PickingWorkspace />
    </Container>
  );
}
