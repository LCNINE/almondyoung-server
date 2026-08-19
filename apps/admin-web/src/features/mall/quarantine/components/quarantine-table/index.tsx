'use client';

// src/features/mall/quarantine/components/quarantine-table/index.tsx
// 미매핑 주문(채널 수집 실패 격리) 목록. 운영 전략이 "격리되면 그때 등록해서 푼다" 이므로
// 이 표가 그 전제조건이다 — 빈 목록·옛 행(라인별 사유 없음)·재처리 불가 행을 모두 다뤄야 한다.

import { useState } from 'react';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { useQuarantinedFailures } from '@/lib/services/channel/queries';
import { canReplay, reasonLabel } from '../../guidance';
import { QuarantineDetailDialog } from '../quarantine-detail-dialog';
import type { OrderCollectionFailureDto } from '@/lib/api/domains/channel/order-collection-failures.client';

export function QuarantineTable() {
  // isFetching 은 뺀다 — 배경 재조회마다 스켈레톤을 다시 씌우면 운영자가 읽던 행 위로
  // "불러오는 중…" 이 매번 깜빡인다. 최초 로딩(isLoading)에만 스켈레톤을 보여준다.
  const { data, isLoading } = useQuarantinedFailures();
  const [selected, setSelected] = useState<OrderCollectionFailureDto | null>(
    null
  );

  const rows = data?.data ?? [];

  return (
    <>
      <div className="px-4 pb-4">
        {/* 한 판의 상한에 닿았다 — 잘린 목록을 전부인 것처럼 보여주면, 안 보이는 주문의 출고가
            멈춘 채 방치된다(lazy 매핑 전략의 급소). 잘렸다는 사실 자체를 표 위에 올린다. */}
        {data?.truncated && (
          <p
            role="status"
            className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          >
            상위 {data.limit}건만 표시했습니다. 이 목록이 전부가 아닙니다 — 먼저 보이는 건들을
            해소한 뒤 다시 불러오세요.
          </p>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>채널</TableHead>
              <TableHead>외부주문번호</TableHead>
              <TableHead>사유</TableHead>
              <TableHead className="text-right">라인</TableHead>
              <TableHead>변경시각</TableHead>
              <TableHead className="text-right">조치</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  불러오는 중…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  격리된 주문이 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const lineCount =
                  row.affectedLines?.length ?? row.affectedLineIds.length;
                const replayable = canReplay(row.status, row.reason);
                return (
                  <TableRow key={row.id}>
                    <TableCell>{row.channel}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.externalOrderId}
                    </TableCell>
                    <TableCell className="text-xs">
                      {reasonLabel(row.reason)}
                    </TableCell>
                    <TableCell className="text-right">{lineCount}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(row.updatedAt).toLocaleString('ko-KR')}
                    </TableCell>
                    <TableCell className="text-right">
                      {replayable ? (
                        <button
                          type="button"
                          className="text-sm text-blue-600 hover:underline"
                          onClick={() => setSelected(row)}
                        >
                          해소하기
                        </button>
                      ) : (
                        <span
                          className="text-xs text-muted-foreground"
                          title="수집 후 채널에서 변경된 건입니다"
                        >
                          CS 처리 필요
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <QuarantineDetailDialog
        failure={selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
