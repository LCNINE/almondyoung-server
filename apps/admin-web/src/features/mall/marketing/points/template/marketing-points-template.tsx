'use client';

import { useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import { usePointsStats, useTopPointUsers } from '@/lib/services/wallet';
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

function TopPointUsersCard() {
  const { data: users, isLoading } = useTopPointUsers(10);

  return (
    <Container className="divide-y-0">
      <div className="px-4 pt-4 pb-2">
        <p className="text-sm font-medium">잔액 상위 10명</p>
      </div>
      <div className="px-4 pb-4">
        {isLoading ? (
          <p className="text-xs text-muted-foreground py-2">불러오는 중...</p>
        ) : !users?.length ? (
          <p className="text-xs text-muted-foreground py-2">데이터 없음</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-1.5 text-left font-medium w-8">#</th>
                <th className="py-1.5 text-left font-medium">사용자 ID</th>
                <th className="py-1.5 text-right font-medium">잔액</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => (
                <tr key={u.userId} className="border-b last:border-0">
                  <td className="py-2 text-muted-foreground">{i + 1}</td>
                  <td className="py-2 font-mono text-xs">{u.userId}</td>
                  <td className="py-2 text-right font-semibold">{u.balance.toLocaleString('ko-KR')}원</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Container>
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

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4 items-start">
        <Container className="divide-y-0">
          <div className="p-4">
            <PointsEventsFilterBox />
            <PointsEventsTable />
          </div>
        </Container>
        <TopPointUsersCard />
      </div>

      <PointsBatchEarnDialog open={batchEarnOpen} onOpenChange={setBatchEarnOpen} />
    </div>
  );
}
