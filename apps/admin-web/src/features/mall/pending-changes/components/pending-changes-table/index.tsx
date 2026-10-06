'use client';

// src/features/mall/pending-changes/components/pending-changes-table/index.tsx
// 채널에서 바뀌었는데 core 가 자동 반영하지 못한 변경(#1016 5번 행)과 그 닫기(6번 행: 무시·다시 확인).

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { usePendingChannelChanges, useDismissChannelChange, useResyncChannelChange } from '@/lib/services/orders';
import {
  blockerCodes,
  blockerLabel,
  resyncLabel,
  summarizeDelta,
} from '@/lib/api/domains/orders/sales-order-amendments.shape';

export function PendingChangesTable() {
  const { data, isLoading, isError, refetch } = usePendingChannelChanges();
  const dismiss = useDismissChannelChange();
  const resync = useResyncChannelChange();
  const [dismissTarget, setDismissTarget] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const rows = data?.items ?? [];
  const now = new Date();

  const closeDialog = () => {
    setDismissTarget(null);
    setNote('');
  };

  return (
    <div className="px-4 pb-4">
      {data?.nextCursor && (
        <p role="status" className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          상위 {rows.length}건만 표시했습니다.
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>채널</TableHead>
            <TableHead>주문번호</TableHead>
            <TableHead>변경</TableHead>
            <TableHead>막힌 이유</TableHead>
            <TableHead>변경시각</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">불러오는 중…</TableCell>
            </TableRow>
          ) : isError ? (
            <TableRow>
              <TableCell colSpan={6} className="py-12 text-center text-sm text-destructive">
                불러오지 못했습니다.
                <Button variant="outline" size="sm" className="ml-2" onClick={() => void refetch()}>
                  다시 시도
                </Button>
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">반영 대기 중인 변경이 없습니다.</TableCell>
            </TableRow>
          ) : (
            rows.map((row) => {
              const pending = row.deltas.filter((delta) => delta.outcome === 'pending');
              const busy = (dismiss.isPending && dismiss.variables?.id === row.id) || (resync.isPending && resync.variables === row.id);
              const requested = resyncLabel(row.resyncRequestedAt, now);
              return (
                <TableRow key={row.id}>
                  <TableCell>{row.salesChannel}</TableCell>
                  <TableCell className="font-mono text-xs">{row.displayOrderNo ?? row.channelOrderId}</TableCell>
                  <TableCell className="text-sm">
                    {pending.map((delta, index) => (
                      <div key={index}>{summarizeDelta(delta)}</div>
                    ))}
                  </TableCell>
                  <TableCell className="text-sm">
                    {pending.map((delta, index) => (
                      <div key={index}>{blockerCodes(delta).map(blockerLabel).join(', ')}</div>
                    ))}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(row.occurredAt).toLocaleString('ko-KR')}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => resync.mutate(row.id)}>
                        다시 확인
                      </Button>
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDismissTarget(row.id)}>
                        무시
                      </Button>
                    </div>
                    {requested && <div className="mt-1 text-xs text-muted-foreground">{requested}</div>}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      <AlertDialog open={dismissTarget !== null} onOpenChange={(open) => !open && closeDialog()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>이 변경을 무시할까요?</AlertDialogTitle>
          </AlertDialogHeader>
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="메모 (선택)" maxLength={500} />
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (dismissTarget) dismiss.mutate({ id: dismissTarget, note: note.trim() || undefined });
                closeDialog();
              }}
            >
              무시
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
