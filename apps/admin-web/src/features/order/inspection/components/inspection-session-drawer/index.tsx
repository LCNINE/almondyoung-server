'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { BarcodeScanInput } from '@/components/common/barcode-scan-input';
import {
  useInspectionSession,
  useInspectionSummary,
} from '@/lib/services/orders/queries';
import {
  useCompleteInspectionSession,
  useInspectByScan,
} from '@/lib/services/orders/mutations';
import type { InspectionSession } from '@/lib/types/dto/fulfillment';
import { InspectItemDialog } from '../inspect-item-dialog';
import { ForceShipmentDialog } from '../force-shipment-dialog';
import { BulkApproveDialog } from '../bulk-approve-dialog';

interface Props {
  session: InspectionSession;
  foId: string;
  onClose: () => void;
}

export function InspectionSessionDrawer({ session, foId, onClose }: Props) {
  const [inspectDialogFoiId, setInspectDialogFoiId] = useState<string | null>(
    null
  );
  const [forceShipFoiId, setForceShipFoiId] = useState<string | null>(null);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [barcode, setBarcode] = useState('');

  const { data: persistedSession } = useInspectionSession(session.id);
  const currentSession = persistedSession ?? session;
  const { data: summary, refetch } = useInspectionSummary(foId);
  const completeMutation = useCompleteInspectionSession();
  const scanMutation = useInspectByScan();
  const selectedInspectionItem = inspectDialogFoiId
    ? currentSession.items.find((item) => item.foiId === inspectDialogFoiId)
    : undefined;

  const handleScan = async (scanned: string) => {
    try {
      const item = await scanMutation.mutateAsync({
        barcode: scanned,
        sessionId: currentSession.id,
        inspectorUserId: currentSession.inspectorUserId,
        quantity: 1,
      });
      toast.success(
        `양품 +1: ${item.skuName} (${item.approvedQty}/${item.pickedQty})`
      );
      refetch();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '스캔 검수에 실패했습니다.');
    }
  };

  const handleComplete = async () => {
    try {
      await completeMutation.mutateAsync({
        sessionId: currentSession.id,
        data: { inspectorUserId: currentSession.inspectorUserId },
      });
      toast.success('검수 세션이 완료되었습니다.');
      onClose();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '완료 처리에 실패했습니다.');
    }
  };

  return (
    <>
      <Sheet open onOpenChange={onClose}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>검수 세션</SheetTitle>
            <SheetDescription className="font-mono text-xs">
              {currentSession.id}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 flex flex-col gap-4">
            {summary && (
              <div className="flex flex-wrap gap-3 rounded-md border p-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">총 항목</span>
                  <span className="font-semibold">{summary.totalItems}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">
                    검수 완료
                  </span>
                  <span className="font-semibold">
                    {summary.inspectedItems}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">미완료</span>
                  <Badge variant="outline">{summary.pendingItems}</Badge>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">승인</span>
                  <Badge variant="default">{summary.approvedItems}</Badge>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">반려</span>
                  <Badge variant="destructive">{summary.rejectedItems}</Badge>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">부분</span>
                  <Badge variant="secondary">{summary.partialItems}</Badge>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">이슈</span>
                  <Badge variant="outline">{summary.totalIssues}</Badge>
                </div>
              </div>
            )}

            {/* 바코드 스캔 = 양품 +1 (불량/부분은 아래 라인별 "검수" 다이얼로그로) */}
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">바코드 스캔 (양품 +1)</span>
              <BarcodeScanInput
                value={barcode}
                onChange={setBarcode}
                onScan={handleScan}
                disabled={scanMutation.isPending}
                autoFocus
              />
              <span className="text-xs text-muted-foreground">
                SKU-... / FOI-... 스캔 시 승인 수량이 1씩 누적됩니다.
              </span>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkDialogOpen(true)}
              >
                일괄 승인
              </Button>
            </div>

            {/* 검수 대상 라인 — 불량/부분 검수는 라인별 "검수" 다이얼로그(수동) */}
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">
                검수 대상 ({currentSession.items.length})
              </span>
              <div className="flex flex-col gap-1 rounded-md border p-2">
                {currentSession.items.map((item) => (
                  <div
                    key={item.foiId}
                    className="flex items-center gap-2 py-1"
                  >
                    <div className="flex flex-1 flex-col">
                      <span className="text-sm font-medium">
                        {item.skuName}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {item.foiId.slice(0, 8)} · 피킹 {item.pickedQty}/
                        {item.requiredQty}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setInspectDialogFoiId(item.foiId)}
                    >
                      검수
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setForceShipFoiId(item.foiId)}
                    >
                      강제출고
                    </Button>
                  </div>
                ))}
                {currentSession.items.length === 0 && (
                  <p className="py-2 text-center text-sm text-muted-foreground">
                    검수 대상이 없습니다.
                  </p>
                )}
              </div>
            </div>

            <Button
              onClick={handleComplete}
              disabled={completeMutation.isPending || !summary?.canComplete}
              className="mt-2"
            >
              {completeMutation.isPending ? '완료 처리 중…' : '검수 완료'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {selectedInspectionItem && (
        <InspectItemDialog
          sessionId={currentSession.id}
          item={selectedInspectionItem}
          inspectorUserId={currentSession.inspectorUserId}
          onClose={() => {
            setInspectDialogFoiId(null);
            refetch();
          }}
        />
      )}

      {forceShipFoiId && (
        <ForceShipmentDialog
          sessionId={currentSession.id}
          foiId={forceShipFoiId}
          authorizedBy={currentSession.inspectorUserId}
          onClose={() => {
            setForceShipFoiId(null);
            refetch();
          }}
        />
      )}

      {bulkDialogOpen && (
        <BulkApproveDialog
          sessionId={currentSession.id}
          inspectorUserId={currentSession.inspectorUserId}
          onClose={() => {
            setBulkDialogOpen(false);
            refetch();
          }}
        />
      )}
    </>
  );
}
