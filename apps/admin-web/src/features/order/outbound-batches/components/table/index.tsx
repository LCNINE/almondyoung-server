'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useWarehouses } from '@/lib/services/inventory/queries';
import { usePermission } from '@/hooks/use-permission';
import {
  FULFILLMENT_SCOPES,
  useOutboundBatchesV2,
} from '@/lib/services/orders';
import type { OutboundBatchV2ListItem } from '@/lib/types/dto/fulfillment';
import { BatchStatusBadge } from '../batch-status-badge';
import { CreateBatchDialog } from '../create-batch-dialog';
import { BatchDetailDrawer } from '../batch-detail-drawer';
import { PermissionAction } from '../../../operation-access-feedback';

export function OutboundBatchesTable() {
  const searchParams = useSearchParams();
  const { hasScope, isPermissionLoading } = usePermission();
  const { data: warehouses = [] } = useWarehouses();
  const [warehouseId, setWarehouseId] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const {
    data: batches = [],
    isLoading,
    error,
  } = useOutboundBatchesV2({
    warehouseId: warehouseId === 'all' ? undefined : warehouseId,
  });
  const canOperateWarehouse =
    !isPermissionLoading && !!hasScope([FULFILLMENT_SCOPES.operate]);

  useEffect(() => {
    const batchId = searchParams.get('batchId');
    if (batchId) setSelectedBatchId(batchId);
  }, [searchParams]);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <Select value={warehouseId} onValueChange={setWarehouseId}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="전체 창고" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 창고</SelectItem>
            {warehouses.map((warehouse) => (
              <SelectItem key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <PermissionAction allowed={canOperateWarehouse}>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            배치 생성
          </Button>
        </PermissionAction>
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          V2 배치를 불러오는 중…
        </p>
      ) : error ? (
        <p className="py-8 text-center text-sm text-destructive">
          배치 목록을 불러오지 못했습니다.
        </p>
      ) : batches.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          출고 배치가 없습니다.
        </p>
      ) : (
        <div className="overflow-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>배치</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>창고</TableHead>
                <TableHead className="text-right">라인</TableHead>
                <TableHead className="text-right">수량</TableHead>
                <TableHead>예정 시각</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((batch: OutboundBatchV2ListItem) => (
                <TableRow
                  key={batch.id}
                  className="cursor-pointer"
                  onClick={() => setSelectedBatchId(batch.id)}
                >
                  <TableCell>
                    <p className="font-medium">
                      {batch.name || batch.batchNumber}
                    </p>
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {batch.id}
                    </p>
                  </TableCell>
                  <TableCell>
                    <BatchStatusBadge status={batch.status} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {batch.warehouseId}
                  </TableCell>
                  <TableCell className="text-right">
                    {batch.totalItems}
                  </TableCell>
                  <TableCell className="text-right">{batch.totalQty}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {batch.scheduledPickingAt
                      ? new Date(batch.scheduledPickingAt).toLocaleString(
                          'ko-KR'
                        )
                      : '미정'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {canOperateWarehouse && (
        <CreateBatchDialog open={createOpen} onOpenChange={setCreateOpen} />
      )}
      {selectedBatchId && (
        <BatchDetailDrawer
          batchId={selectedBatchId}
          open
          onOpenChange={(open) => {
            if (!open) setSelectedBatchId(null);
          }}
        />
      )}
    </div>
  );
}
