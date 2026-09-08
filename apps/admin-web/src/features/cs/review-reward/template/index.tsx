'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { RuleList } from '../components/rule-list';
import { BestSelections } from '../components/best-selections';
import { GrantsPanel } from '../components/grants-panel';

export default function ReviewRewardTemplate() {
  return (
    <Container>
      <Header title="리뷰 보상 정책" />
      <div className="space-y-4">
        <p className="rounded-[10px] border border-gray-200 bg-gray-50 px-4 py-3 text-xs leading-relaxed text-gray-600">
          리뷰를 쓰면 무엇을 줄지는 <strong>여기서만</strong> 정해집니다. 규칙이 하나도 활성이 아니면 아무 보상도
          나가지 않고, 고객 화면의 적립 안내 문구도 뜨지 않습니다. 규칙은 만들자마자 도는 게 아니라
          <strong> 활성화한 순간부터</strong> 적용됩니다.
        </p>
        <RuleList />
        <BestSelections />
        <GrantsPanel />
      </div>
    </Container>
  );
}
