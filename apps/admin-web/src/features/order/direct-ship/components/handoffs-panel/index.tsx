'use client';

import { useState } from 'react';
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
import { usePermissionCheck } from '@/hooks/use-permission';
import { getServerDenyMessage } from '@/lib/api/server-error';
import { useRedownloadHandoffSheet, useSupplierHandoffs } from '@/lib/services/orders';
import { handoffOutcome } from '../../lib/handoff-outcome';
import { downloadSupplierSheet } from '../../lib/supplier-sheet-xlsx';
import { ExportReasonDialog } from '../export-reason-dialog';

/** 「넘긴 것」 — 넘김 묶음(최근 50개). 다시 받기는 가린 시트의 복구 길이다(N3) */
export function HandoffsPanel({ supplierId }: { supplierId: string }) {
  const { canRun } = usePermissionCheck();
  const { data: handoffs = [], isLoading } = useSupplierHandoffs(supplierId);
  const redownload = useRedownloadHandoffSheet();
  const [target, setTarget] = useState<string | null>(null);
  const [maskedMessage, setMaskedMessage] = useState<string | null>(null);

  const confirm = async (reason: string) => {
    if (target === null) return;
    try {
      const res = await redownload.mutateAsync({ handoffId: target, reason });
      const outcome = handoffOutcome(res);
      if (outcome.download) downloadSupplierSheet(res.sheet);
      setMaskedMessage(outcome.maskedMessage);
      setTarget(null);
    } catch (error) {
      toast.error(getServerDenyMessage(error, '시트를 다시 받지 못했습니다.'));
    }
  };

  if (isLoading) return null;
  if (handoffs.length === 0) {
    return <div className="p-8 text-center text-sm text-muted-foreground">넘긴 묶음이 없습니다.</div>;
  }

  const canRedownload = canRun(useRedownloadHandoffSheet);

  return (
    <div className="space-y-3 p-4">
      {maskedMessage && (
        <Alert variant="destructive">
          <AlertDescription>{maskedMessage}</AlertDescription>
        </Alert>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>넘긴 시각</TableHead>
            <TableHead>넘긴 사람</TableHead>
            <TableHead className="text-right">열림</TableHead>
            <TableHead className="text-right">발송</TableHead>
            <TableHead className="text-right">못 보냄</TableHead>
            {canRedownload && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {handoffs.map((h) => (
            <TableRow key={h.handoffId}>
              <TableCell>{new Date(h.createdAt).toLocaleString('ko-KR')}</TableCell>
              <TableCell className="font-mono text-xs" title={h.createdBy}>
                {h.createdBy.slice(0, 8)}
              </TableCell>
              <TableCell className="text-right">{h.openShipments}</TableCell>
              <TableCell className="text-right">{h.shippedShipments}</TableCell>
              <TableCell className="text-right">{h.unfulfillableLines}</TableCell>
              {canRedownload && (
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTarget(h.handoffId)}
                    disabled={redownload.isPending}
                  >
                    다시 받기
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ExportReasonDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        title="시트 다시 받기"
        confirmLabel="내려받기"
        pending={redownload.isPending}
        onConfirm={confirm}
      />
    </div>
  );
}
