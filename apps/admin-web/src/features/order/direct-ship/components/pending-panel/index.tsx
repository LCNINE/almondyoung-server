'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Can } from '@/components/auth/can';
import { getServerDenyMessage } from '@/lib/api/server-error';
import { useHandOffToSupplier, useSupplierShipments } from '@/lib/services/orders';
import { type HandoffOutcome, handoffOutcome } from '../../lib/handoff-outcome';
import { downloadSupplierSheet } from '../../lib/supplier-sheet-xlsx';
import { ExportReasonDialog } from '../export-reason-dialog';
import { SkippedShipmentsAlert } from '../skipped-shipments-alert';

/** 「대기」 — 아직 입점사에게 넘기지 않은 상자. 넘김 = 묶음을 찍고 시트를 받는다 */
export function PendingPanel({ supplierId }: { supplierId: string }) {
  const { data: shipments = [], isLoading } = useSupplierShipments(supplierId, 'pending');
  const handOff = useHandOffToSupplier();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [outcome, setOutcome] = useState<HandoffOutcome | null>(null);

  const confirm = async (reason: string) => {
    try {
      const res = await handOff.mutateAsync({ supplierId, reason });
      const next = handoffOutcome(res);
      if (next.download) downloadSupplierSheet(res.sheet);
      setOutcome(next);
      setDialogOpen(false);
    } catch (error) {
      toast.error(getServerDenyMessage(error, '넘김에 실패했습니다.'));
    }
  };

  if (isLoading) return null;

  return (
    <div className="space-y-3 p-4">
      <div className="flex justify-end">
        <Can run={useHandOffToSupplier}>
          <Button
            size="sm"
            onClick={() => setDialogOpen(true)}
            disabled={shipments.length === 0 || handOff.isPending}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            시트 내려받기(넘김)
          </Button>
        </Can>
      </div>

      {outcome?.maskedMessage && (
        <Alert variant="destructive">
          <AlertDescription>{outcome.maskedMessage}</AlertDescription>
        </Alert>
      )}
      <SkippedShipmentsAlert skipped={outcome?.skipped ?? null} />

      {shipments.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">넘길 상자가 없습니다.</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>주문번호</TableHead>
              <TableHead>상품</TableHead>
              <TableHead className="text-right">수량</TableHead>
              <TableHead>열린 시각</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shipments.map((s) => (
              <TableRow key={s.shipmentId}>
                <TableCell>{s.orderNo}</TableCell>
                <TableCell>
                  {s.lines.map((l) => (
                    <div key={l.shipmentLineId}>{l.skuName}</div>
                  ))}
                </TableCell>
                <TableCell className="text-right">
                  {s.lines.map((l) => (
                    <div key={l.shipmentLineId}>{l.qty}</div>
                  ))}
                </TableCell>
                <TableCell>{new Date(s.openedAt).toLocaleString('ko-KR')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ExportReasonDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="입점사에게 넘기기"
        confirmLabel="넘기고 내려받기"
        pending={handOff.isPending}
        onConfirm={confirm}
      />
    </div>
  );
}
