'use client';

import Link from 'next/link';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useRunOutboundPreparation,
  useSplitUnreservedMany,
} from '@/lib/services/orders';
import type {
  OutboundPreparationSummary,
  PreparationBucket,
} from '@/lib/types/dto/fulfillment';

export const BUCKET_LABELS: Record<PreparationBucket, string> = {
  ready: '완전출고',
  partial: '부분출고',
  unavailable: '출고불가',
  mergeable: '합칠 주문 있음',
  resume: '이어서 처리',
  needs_info: '정보 부족',
};

const ROWS = [
  'ready',
  'partial',
  'unavailable',
  'matching',
  'mergeable',
  'resume',
  'needs_info',
] as const;

export function BucketTable({
  summary,
  busy,
  canPrepare,
  selectedCount,
  onView,
  onPrepare,
  onSplit,
}: {
  summary: OutboundPreparationSummary;
  busy: boolean;
  canPrepare: boolean;
  selectedCount: (bucket: PreparationBucket) => number;
  onView: (bucket: PreparationBucket) => void;
  onPrepare: (bucket: 'ready' | 'resume') => void;
  onSplit: () => void;
}) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>구분</TableHead>
            <TableHead>상자 수</TableHead>
            <TableHead>기능</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ROWS.map((key) => {
            const bucket = summary.buckets.find(
              (entry) => entry.bucket === key
            );
            const count =
              key === 'matching'
                ? summary.awaitingMatchingCount
                : (bucket?.count ?? 0);
            const disabled = busy || count === 0;

            return (
              <TableRow key={key}>
                <TableCell className="bg-muted/40 font-semibold">
                  {key === 'matching' ? '미매칭' : BUCKET_LABELS[key]}
                </TableCell>
                <TableCell className="tabular-nums">
                  <span className="font-semibold text-foreground">
                    {count}장
                  </span>
                  {key === 'ready' && (
                    <span className="ml-3 text-sm text-muted-foreground">
                      단일 {bucket?.singleCount ?? 0} / 합포{' '}
                      {bucket?.multiCount ?? 0}
                    </span>
                  )}
                  {key === 'matching' && (
                    <span className="ml-3 text-sm text-muted-foreground">
                      전 창고
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    {(key === 'ready' || key === 'resume') && (
                      <Can run={useRunOutboundPreparation}>
                        <Button
                          size="sm"
                          disabled={
                            disabled || !canPrepare || selectedCount(key) === 0
                          }
                          onClick={() => onPrepare(key)}
                        >
                          {key === 'resume' ? '이어서 출고 준비' : '출고 준비'}
                        </Button>
                      </Can>
                    )}
                    {key === 'partial' && (
                      <Can run={useSplitUnreservedMany}>
                        <Button
                          size="sm"
                          disabled={disabled || selectedCount(key) === 0}
                          onClick={onSplit}
                        >
                          있는 것만 먼저 보내기
                        </Button>
                      </Can>
                    )}
                    {key === 'matching' ? (
                      disabled ? (
                        <Button size="sm" variant="outline" disabled>
                          매칭하러 가기
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" asChild>
                          <Link href="/order/matching">매칭하러 가기</Link>
                        </Button>
                      )
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={disabled}
                        onClick={() => onView(key)}
                      >
                        내역보기
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
