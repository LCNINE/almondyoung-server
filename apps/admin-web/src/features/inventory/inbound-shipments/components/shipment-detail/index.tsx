'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useInboundShipment } from '@/lib/services/inventory/inbound-shipment-queries';
import { ShipmentHeader } from './header';
import { ForwardStrip } from './forward-strip';
import { LinesTable } from './lines-table';
import { LineDrawer } from './line-drawer';
import { BoxesTab } from './boxes-tab';
import { SummaryCards } from './summary-cards';
import { UnplannedTab } from './unplanned-tab';

/**
 * 선적 상세. 머리·탭·줄 서랍은 상태와 상관없이 같은 부품이고,
 * 초안 전용 부분(전달용 띠·확정)만 status 로 갈린다 — 확정 뒤 화면은 이 파일 위쪽에서 갈래를 더한다.
 */
export function ShipmentDetail({ id }: { id: string }) {
  const { data: shipment, isLoading, refetch } = useInboundShipment(id);
  const [tab, setTab] = useState<'lines' | 'boxes' | 'unplanned'>('lines');
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  // 화면 상태일 뿐 저장하지 않는다.
  const [acknowledged, setAcknowledged] = useState<ReadonlySet<string>>(new Set());

  if (!shipment) {
    return <div className="p-4 text-sm text-muted-foreground">{isLoading ? '불러오는 중…' : '선적을 찾을 수 없습니다.'}</div>;
  }
  const isDraft = shipment.status === 'draft';
  const selectedLine = shipment.lines.find((l) => l.id === selectedLineId) ?? null;

  const setChecked = (boxId: string, checked: boolean) =>
    setAcknowledged((prev) => {
      const next = new Set(prev);
      if (checked) next.add(boxId);
      else next.delete(boxId);
      return next;
    });

  return (
    <div className="flex flex-col gap-3 p-4">
      <ShipmentHeader shipment={shipment} acknowledged={acknowledged} onStale={() => void refetch()} />
      {!isDraft && shipment.status !== 'canceled' && <SummaryCards shipment={shipment} />}
      {isDraft && <ForwardStrip shipment={shipment} acknowledged={acknowledged} onCheck={setChecked} />}
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'lines' | 'boxes' | 'unplanned')}>
        <TabsList>
          <TabsTrigger value="lines">줄</TabsTrigger>
          <TabsTrigger value="boxes">상자</TabsTrigger>
          {!isDraft && <TabsTrigger value="unplanned">리스트에 없던 물건</TabsTrigger>}
        </TabsList>
      </Tabs>
      {tab === 'lines' ? (
        <LinesTable shipment={shipment} onSelect={setSelectedLineId} />
      ) : tab === 'unplanned' && !isDraft ? (
        <UnplannedTab shipment={shipment} />
      ) : (
        <BoxesTab shipment={shipment} onForgetAck={(boxId) => setChecked(boxId, false)} />
      )}
      <LineDrawer shipment={shipment} line={selectedLine} onClose={() => setSelectedLineId(null)} />
    </div>
  );
}
