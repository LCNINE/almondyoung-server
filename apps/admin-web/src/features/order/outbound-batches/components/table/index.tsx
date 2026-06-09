'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus } from 'lucide-react';
import { useOutboundBatches } from '@/lib/services/orders';
import { useWarehouses } from '@/lib/services/inventory/queries';
import { BatchStatusBadge } from '../batch-status-badge';
import { CreateBatchDialog } from '../create-batch-dialog';
import { BatchDetailDrawer } from '../batch-detail-drawer';
import type { OutboundBatch } from '@/lib/types/dto/fulfillment';

const PAGE_SIZE = 20;

// ⚠️ 서버 priority 정렬이 알파벳 순(urgent>normal>high) — 의미상 순서와 다름
const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2 };

export function OutboundBatchesTable() {
  const searchParams = useSearchParams();
  const { data: warehouses = [] } = useWarehouses();
  const [warehouseId, setWarehouseId] = useState<string>('all');
  const { data: batches = [], isLoading } = useOutboundBatches(
    warehouseId === 'all' ? undefined : warehouseId
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  const batchIdParam = searchParams.get('batchId');
  useEffect(() => {
    if (batchIdParam) setSelectedBatchId(batchIdParam);
  }, [batchIdParam]);

  const sorted = [...batches].sort(
    (a, b) => (PRIORITY_ORDER[a.status] ?? 9) - (PRIORITY_ORDER[b.status] ?? 9)
  );

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Select value={warehouseId} onValueChange={setWarehouseId}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="전체 창고" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 창고</SelectItem>
              {warehouses.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          배치 생성
        </Button>
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">로딩 중...</p>
      ) : sorted.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">출고 배치가 없습니다.</p>
      ) : (
        <div className="overflow-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>배치명</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>피킹 방식</TableHead>
                <TableHead className="text-right">라인</TableHead>
                <TableHead className="text-right">수량</TableHead>
                <TableHead>생성일</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.slice(0, PAGE_SIZE).map((batch: OutboundBatch) => (
                <TableRow
                  key={batch.id}
                  className="cursor-pointer"
                  onClick={() => setSelectedBatchId(batch.id)}
                >
                  <TableCell className="font-medium">
                    {batch.name ?? (
                      <span className="font-mono text-xs text-muted-foreground">
                        {batch.id.substring(0, 8)}…
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <BatchStatusBadge status={batch.status} />
                  </TableCell>
                  <TableCell>
                    {batch.pickingMethod === 'individual' ? '개별' : '합산'}
                  </TableCell>
                  <TableCell className="text-right">{batch.totalItems}</TableCell>
                  <TableCell className="text-right">{batch.totalQty}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(batch.createdAt).toLocaleDateString('ko-KR')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateBatchDialog open={createOpen} onOpenChange={setCreateOpen} />

      {selectedBatchId && (
        <BatchDetailDrawer
          batchId={selectedBatchId}
          warehouseId={
            batches.find((b: OutboundBatch) => b.id === selectedBatchId)?.warehouseId ?? ''
          }
          open={!!selectedBatchId}
          onOpenChange={(open) => !open && setSelectedBatchId(null)}
        />
      )}
    </div>
  );
}
