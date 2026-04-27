'use client';

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
import { useInspectionSummary } from '@/lib/services/orders/queries';
import {
  useCompleteInspectionSession,
  useInspectItem,
  useForceShipment,
  useBulkApprove,
  useResetInspection,
} from '@/lib/services/orders/mutations';
import type { InspectionSession } from '@/lib/types/dto/fulfillment';
import { InspectItemDialog } from '../inspect-item-dialog';
import { ForceShipmentDialog } from '../force-shipment-dialog';
import { BulkApproveDialog } from '../bulk-approve-dialog';
import { useState } from 'react';

interface Props {
  session: InspectionSession;
  foId: string;
  onClose: () => void;
}

export function InspectionSessionDrawer({ session, foId, onClose }: Props) {
  const [inspectDialogFoiId, setInspectDialogFoiId] = useState<string | null>(null);
  const [forceShipFoiId, setForceShipFoiId] = useState<string | null>(null);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);

  const { data: summary, refetch } = useInspectionSummary(foId);
  const completeMutation = useCompleteInspectionSession();
  const resetMutation = useResetInspection();

  const handleComplete = async () => {
    try {
      await completeMutation.mutateAsync({
        sessionId: session.id,
        data: { sessionId: session.id, inspectorUserId: session.inspectorUserId },
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
            <SheetDescription className="font-mono text-xs">{session.id}</SheetDescription>
          </SheetHeader>

          <div className="mt-4 flex flex-col gap-4">
            {summary && (
              <div className="flex flex-wrap gap-3 rounded-md border p-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">총 항목</span>
                  <span className="font-semibold">{summary.totalItems}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">검수 완료</span>
                  <span className="font-semibold">{summary.inspectedItems}</span>
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
                  <span className="text-xs text-muted-foreground">강제출고</span>
                  <Badge variant="secondary">{summary.forcedItems}</Badge>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkDialogOpen(true)}
              >
                일괄 승인
              </Button>
            </div>

            <p className="text-sm text-muted-foreground">
              항목별 검수를 진행하려면 FO 라인 ID를 입력하세요.
            </p>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setInspectDialogFoiId(foId)}
              >
                검수 입력
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setForceShipFoiId(foId)}
              >
                강제 출고
              </Button>
            </div>

            <Button
              onClick={handleComplete}
              disabled={completeMutation.isPending}
              className="mt-2"
            >
              {completeMutation.isPending ? '완료 처리 중…' : '검수 완료'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {inspectDialogFoiId && (
        <InspectItemDialog
          sessionId={session.id}
          foiId={inspectDialogFoiId}
          inspectorUserId={session.inspectorUserId}
          onClose={() => {
            setInspectDialogFoiId(null);
            refetch();
          }}
        />
      )}

      {forceShipFoiId && (
        <ForceShipmentDialog
          foiId={forceShipFoiId}
          authorizedBy={session.inspectorUserId}
          onClose={() => {
            setForceShipFoiId(null);
            refetch();
          }}
        />
      )}

      {bulkDialogOpen && (
        <BulkApproveDialog
          inspectorUserId={session.inspectorUserId}
          onClose={() => {
            setBulkDialogOpen(false);
            refetch();
          }}
        />
      )}
    </>
  );
}
