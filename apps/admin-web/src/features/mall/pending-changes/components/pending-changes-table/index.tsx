'use client';

// src/features/mall/pending-changes/components/pending-changes-table/index.tsx
// 채널에서 바뀌었는데 core 가 자동 반영하지 못한 변경(#1016 5번 행). 닫기(처리완료·무시)는 6번 행 몫이다.

import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { usePendingChannelChanges } from '@/lib/services/orders';
import {
  blockerCodes,
  blockerLabel,
  summarizeDelta,
} from '@/lib/api/domains/orders/sales-order-amendments.shape';

export function PendingChangesTable() {
  const { data, isLoading, isError, refetch } = usePendingChannelChanges();
  const rows = data?.items ?? [];

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
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">불러오는 중…</TableCell>
            </TableRow>
          ) : isError ? (
            <TableRow>
              <TableCell colSpan={5} className="py-12 text-center text-sm text-destructive">
                불러오지 못했습니다.
                <Button variant="outline" size="sm" className="ml-2" onClick={() => void refetch()}>
                  다시 시도
                </Button>
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">반영 대기 중인 변경이 없습니다.</TableCell>
            </TableRow>
          ) : (
            rows.map((row) => {
              const pending = row.deltas.filter((delta) => delta.outcome === 'pending');
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
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
