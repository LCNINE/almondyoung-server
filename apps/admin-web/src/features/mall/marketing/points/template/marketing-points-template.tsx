'use client';

import { useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import { usePointsStats } from '@/lib/services/wallet';
import { PointsEventsFilterBox } from '../components/filter-box';
import { PointsEventsTable } from '../components/table';
import { PointsBatchEarnDialog } from '../components/points-batch-earn-dialog';

function PointsStatsCards() {
  const { data: stats } = usePointsStats();

  const cards = [
    { label: '총 발행', value: stats?.totalEarned ?? 0 },
    { label: '총 사용', value: stats?.totalRedeemed ?? 0 },
    { label: '적립 취소', value: stats?.totalCancelled ?? 0 },
    { label: '현재 유통 중', value: stats?.currentCirculating ?? 0, highlight: true },
  ];

  return (
    <div className="grid grid-cols-4 gap-4 px-4 pb-4">
      {cards.map((card) => (
        <div key={card.label} className="shadow-[0px_0px_0px_2px_rgba(0,0,0,0.12)] rounded-lg p-4">
          <p className="text-sm font-medium text-muted-foreground">{card.label}</p>
          <p className={`text-2xl font-bold mt-1 ${card.highlight ? 'text-primary' : ''}`}>
            {card.value.toLocaleString('ko-KR')}
          </p>
        </div>
      ))}
    </div>
  );
}

export default function MarketingPointsTemplate() {
  const [batchEarnOpen, setBatchEarnOpen] = useState(false);

  return (
    <div className="space-y-4">
      <Container className="divide-y-0">
        <Header
          title="적립금 관리"
          subtitle="적립금 통계 및 내역을 조회하고 일괄 지급합니다."
          right={
            <Button onClick={() => setBatchEarnOpen(true)} className="bg-orange-500 text-white hover:bg-orange-600">
              일괄 지급
            </Button>
          }
        />
        <PointsStatsCards />
      </Container>

      <Container className="divide-y-0">
        <div className="p-4">
          <PointsEventsFilterBox />
          <PointsEventsTable />
        </div>
      </Container>

      <PointsBatchEarnDialog open={batchEarnOpen} onOpenChange={setBatchEarnOpen} />
    </div>
  );
}
