'use client';

import { useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useReservationsBySku,
  useReservationsByTarget,
  useReservationSummary,
  useExpireStaleReservations,
} from '@/lib/services/inventory';
import type { ReservationTargetType } from '@/lib/types/dto/inventory';
import { ReservationsTable } from '../components/reservations-table';
import { ReservationSummaryTable } from '../components/summary-table';
import { toast } from 'sonner';

type SearchMode = 'sku' | 'target' | 'summary';

export default function ReservationsTemplate() {
  const [mode, setMode] = useState<SearchMode>('sku');

  const [skuId, setSkuId] = useState('');
  const [skuWarehouseId, setSkuWarehouseId] = useState('');
  const [committedSkuId, setCommittedSkuId] = useState('');
  const [committedSkuWarehouseId, setCommittedSkuWarehouseId] = useState('');

  const [targetType, setTargetType] = useState<ReservationTargetType>('FULFILLMENT_ORDER');
  const [targetId, setTargetId] = useState('');
  const [committedTargetType, setCommittedTargetType] = useState<ReservationTargetType>('FULFILLMENT_ORDER');
  const [committedTargetId, setCommittedTargetId] = useState('');

  const [summaryWarehouseId, setSummaryWarehouseId] = useState('');
  const [committedSummaryWarehouseId, setCommittedSummaryWarehouseId] = useState('');

  const expireMutation = useExpireStaleReservations();

  const { data: skuReservations = [], isLoading: isSkuLoading } = useReservationsBySku(
    committedSkuId,
    committedSkuWarehouseId || undefined
  );
  const { data: targetReservations = [], isLoading: isTargetLoading } = useReservationsByTarget(
    committedTargetType,
    committedTargetId
  );
  const { data: summaryData = [], isLoading: isSummaryLoading } = useReservationSummary(
    committedSummaryWarehouseId
  );

  const handleExpireStale = async () => {
    try {
      const result = await expireMutation.mutateAsync();
      toast.success(`만료된 예약 ${result.releasedCount}건이 해제되었습니다.`);
    } catch {
      toast.error('만료된 예약 해제에 실패했습니다.');
    }
  };

  const handleSkuSearch = () => {
    setCommittedSkuId(skuId);
    setCommittedSkuWarehouseId(skuWarehouseId);
  };

  const handleTargetSearch = () => {
    setCommittedTargetType(targetType);
    setCommittedTargetId(targetId);
  };

  const handleSummarySearch = () => {
    setCommittedSummaryWarehouseId(summaryWarehouseId);
  };

  return (
    <Container className="divide-y-0">
      <Header
        title="재고 예약"
        subtitle="SKU · 주문 · 창고별 재고 예약을 모니터링하고 관리합니다."
        right={
          <Button
            variant="outline"
            size="sm"
            onClick={handleExpireStale}
            disabled={expireMutation.isPending}
          >
            {expireMutation.isPending ? '처리 중...' : '만료된 예약 일괄 해제'}
          </Button>
        }
      />

      <div className="px-4 pt-4">
        <div className="flex gap-1 border-b">
          {(['sku', 'target', 'summary'] as SearchMode[]).map((m) => (
            <button
              key={m}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                mode === m
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setMode(m)}
            >
              {m === 'sku' ? 'SKU 검색' : m === 'target' ? 'Target 검색' : '창고 요약'}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {mode === 'sku' && (
            <div className="flex items-end gap-3 mb-4">
              <div className="space-y-1">
                <Label className="text-xs">SKU ID</Label>
                <Input
                  value={skuId}
                  onChange={(e) => setSkuId(e.target.value)}
                  placeholder="SKU ID 입력"
                  className="w-64"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSkuSearch(); }}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">창고 ID (선택)</Label>
                <Input
                  value={skuWarehouseId}
                  onChange={(e) => setSkuWarehouseId(e.target.value)}
                  placeholder="창고 ID 입력"
                  className="w-48"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSkuSearch(); }}
                />
              </div>
              <Button size="sm" onClick={handleSkuSearch}>
                검색
              </Button>
            </div>
          )}

          {mode === 'target' && (
            <div className="flex items-end gap-3 mb-4">
              <div className="space-y-1">
                <Label className="text-xs">대상 타입</Label>
                <select
                  value={targetType}
                  onChange={(e) => setTargetType(e.target.value as ReservationTargetType)}
                  className="flex h-9 w-48 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="FULFILLMENT_ORDER">풀필먼트 주문</option>
                  <option value="MOVEMENT_TASK">이동 작업</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">대상 ID</Label>
                <Input
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  placeholder="대상 ID 입력"
                  className="w-64"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleTargetSearch(); }}
                />
              </div>
              <Button size="sm" onClick={handleTargetSearch}>
                검색
              </Button>
            </div>
          )}

          {mode === 'summary' && (
            <div className="flex items-end gap-3 mb-4">
              <div className="space-y-1">
                <Label className="text-xs">창고 ID</Label>
                <Input
                  value={summaryWarehouseId}
                  onChange={(e) => setSummaryWarehouseId(e.target.value)}
                  placeholder="창고 ID 입력"
                  className="w-64"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSummarySearch(); }}
                />
              </div>
              <Button size="sm" onClick={handleSummarySearch}>
                검색
              </Button>
            </div>
          )}
        </div>
      </div>

      {mode === 'sku' && (
        <ReservationsTable data={skuReservations} isLoading={isSkuLoading} />
      )}
      {mode === 'target' && (
        <ReservationsTable data={targetReservations} isLoading={isTargetLoading} />
      )}
      {mode === 'summary' && (
        <ReservationSummaryTable data={summaryData} isLoading={isSummaryLoading} />
      )}
    </Container>
  );
}
