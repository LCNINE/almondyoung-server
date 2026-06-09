'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Trash2, Play, CheckCircle, XCircle, PackagePlus, ExternalLink } from 'lucide-react';
import {
  useOutboundBatch,
  useStartBatchPicking,
  useCompleteBatch,
  useCancelBatch,
  useRemoveFOFromBatch,
} from '@/lib/services/orders';
import { BatchStatusBadge } from '../batch-status-badge';
import { PickingListAggregate } from '../picking-list-aggregate';
import { AvailableFOsDrawer } from '../available-fos-drawer';
import type { OutboundBatchFO } from '@/lib/types/dto/fulfillment';

interface Props {
  batchId: string;
  warehouseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PRIORITY_LABELS: Record<string, string> = {
  urgent: '긴급',
  high: '높음',
  normal: '일반',
};

export function BatchDetailDrawer({ batchId, warehouseId, open, onOpenChange }: Props) {
  const { data: batch, isLoading } = useOutboundBatch(batchId);
  const startPicking = useStartBatchPicking();
  const completeBatch = useCompleteBatch();
  const cancelBatch = useCancelBatch();
  const removeFO = useRemoveFOFromBatch(batchId);
  const [addFOsOpen, setAddFOsOpen] = useState(false);
  const [showPickingList, setShowPickingList] = useState(false);

  if (!open) return null;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-[720px] sm:max-w-[720px] overflow-auto">
          <SheetHeader>
            <SheetTitle>배치 상세</SheetTitle>
          </SheetHeader>

          {isLoading || !batch ? (
            <p className="mt-4 text-sm text-muted-foreground">로딩 중...</p>
          ) : (
            <div className="mt-4 flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3 rounded-lg border p-4 text-sm">
                <div>
                  <p className="text-muted-foreground">배치 ID</p>
                  <p className="font-mono text-xs mt-0.5">{batch.id}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">상태</p>
                  <div className="mt-0.5">
                    <BatchStatusBadge status={batch.status} />
                  </div>
                </div>
                <div>
                  <p className="text-muted-foreground">피킹 방식</p>
                  <p className="mt-0.5">
                    {batch.pickingMethod === 'individual' ? '개별 피킹' : '합산 피킹'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">총 수량</p>
                  <p className="mt-0.5">{batch.totalQty} 개</p>
                </div>
                {batch.name && (
                  <div className="col-span-2">
                    <p className="text-muted-foreground">배치명</p>
                    <p className="mt-0.5">{batch.name}</p>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {batch.status === 'created' && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setAddFOsOpen(true)}
                    >
                      <PackagePlus className="mr-1.5 h-3.5 w-3.5" />
                      FO 추가
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => startPicking.mutate(batch.id)}
                      disabled={
                        startPicking.isPending ||
                        !batch.fulfillmentOrders?.length
                      }
                    >
                      <Play className="mr-1.5 h-3.5 w-3.5" />
                      피킹 시작
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => cancelBatch.mutate(batch.id)}
                      disabled={cancelBatch.isPending}
                    >
                      <XCircle className="mr-1.5 h-3.5 w-3.5" />
                      취소
                    </Button>
                  </>
                )}
                {batch.status === 'picking' && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowPickingList((v) => !v)}
                    >
                      {showPickingList ? '피킹 목록 숨기기' : '피킹 목록 보기'}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => completeBatch.mutate(batch.id)}
                      disabled={completeBatch.isPending}
                    >
                      <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
                      피킹 완료
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => cancelBatch.mutate(batch.id)}
                      disabled={cancelBatch.isPending}
                    >
                      <XCircle className="mr-1.5 h-3.5 w-3.5" />
                      취소
                    </Button>
                  </>
                )}
              </div>

              {showPickingList && batch.status === 'picking' && (
                <>
                  <Separator />
                  <div>
                    <p className="mb-2 text-sm font-medium">SKU 집계 피킹 목록</p>
                    <PickingListAggregate batchId={batch.id} />
                  </div>
                </>
              )}

              <Separator />

              <div>
                <p className="mb-2 text-sm font-medium">
                  포함된 FO ({batch.fulfillmentOrders?.length ?? 0}건)
                </p>
                {batch.fulfillmentOrders?.length === 0 ? (
                  <p className="text-sm text-muted-foreground">FO가 없습니다.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>FO ID</TableHead>
                        <TableHead>상태</TableHead>
                        <TableHead>우선순위</TableHead>
                        <TableHead className="text-right">수량</TableHead>
                        {batch.status === 'created' && <TableHead />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {batch.fulfillmentOrders?.map((fo: OutboundBatchFO) => (
                        <TableRow key={fo.id}>
                          <TableCell>
                            <Link
                              href={`/order/fulfillments/${fo.id}`}
                              className="flex items-center gap-1 font-mono text-xs hover:underline"
                              onClick={() => onOpenChange(false)}
                            >
                              {fo.id.substring(0, 8)}…
                              <ExternalLink className="h-3 w-3 text-muted-foreground" />
                            </Link>
                          </TableCell>
                          <TableCell>{fo.status}</TableCell>
                          <TableCell>
                            {PRIORITY_LABELS[fo.priority] ?? fo.priority}
                          </TableCell>
                          <TableCell className="text-right">{fo.totalQty}</TableCell>
                          {batch.status === 'created' && (
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive"
                                onClick={() => removeFO.mutate(fo.id)}
                                disabled={removeFO.isPending}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {batch && (
        <AvailableFOsDrawer
          batchId={batchId}
          warehouseId={warehouseId}
          open={addFOsOpen}
          onOpenChange={setAddFOsOpen}
        />
      )}
    </>
  );
}
