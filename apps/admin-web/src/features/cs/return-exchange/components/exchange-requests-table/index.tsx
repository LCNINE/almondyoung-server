'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
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
  useExchangeRequests,
  useApproveExchange,
  useRejectExchange,
  useMarkExchangeCollectionPending,
  useMarkExchangeCollected,
  useMarkExchangeInspected,
  useCompleteExchange,
} from '@/lib/services/return-exchange';
import type { ExchangeRequest } from '@/lib/api/domains/return-exchange';

const STATUS_LABELS: Record<ExchangeRequest['status'], string> = {
  requested: '신청',
  approved: '승인',
  rejected: '거절',
  collection_pending: '수거 대기',
  collected: '수거 완료',
  inspected: '검수 완료',
  refund_pending: '환불 대기',
  completed: '완료',
  cancelled: '취소',
};

const STATUS_VARIANTS: Record<ExchangeRequest['status'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
  requested: 'default',
  approved: 'secondary',
  rejected: 'destructive',
  collection_pending: 'secondary',
  collected: 'secondary',
  inspected: 'secondary',
  refund_pending: 'outline',
  completed: 'outline',
  cancelled: 'destructive',
};

interface Props {
  statusFilter?: string;
  page: number;
  onPageChange: (p: number) => void;
}

const PAGE_SIZE = 20;

export function ExchangeRequestsTable({ statusFilter, page, onPageChange }: Props) {
  const query = { status: statusFilter, page, limit: PAGE_SIZE };
  const { data, isLoading, isFetching } = useExchangeRequests(query);

  const approve = useApproveExchange();
  const reject = useRejectExchange();
  const collectionPending = useMarkExchangeCollectionPending();
  const collected = useMarkExchangeCollected();
  const inspected = useMarkExchangeInspected();
  const complete = useCompleteExchange();

  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>, label: string) => {
    try {
      await fn();
      toast.success(`${label} 처리되었습니다.`);
    } catch {
      toast.error(`${label} 처리에 실패했습니다.`);
    }
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-3">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[180px]">요청 ID</TableHead>
              <TableHead className="w-[180px]">주문 ID</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>사유</TableHead>
              <TableHead>신청일</TableHead>
              <TableHead className="text-right">액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  불러오는 중...
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  교환 요청이 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              items.map(({ request }) => (
                <TableRow key={request.id} className={isFetching ? 'opacity-60' : ''}>
                  <TableCell className="font-mono text-xs">{request.id.slice(0, 8)}…</TableCell>
                  <TableCell className="font-mono text-xs">{request.salesOrderId.slice(0, 8)}…</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[request.status]}>
                      {STATUS_LABELS[request.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{request.reasonCode}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(request.createdAt).toLocaleDateString('ko-KR')}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end flex-wrap">
                      {request.status === 'requested' && (
                        <>
                          <Button
                            size="sm"
                            variant="default"
                            disabled={approve.isPending && confirmingId === request.id}
                            onClick={() => {
                              setConfirmingId(request.id);
                              act(() => approve.mutateAsync({ id: request.id }), '승인');
                            }}
                          >
                            승인
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={reject.isPending && confirmingId === request.id}
                            onClick={() => {
                              setConfirmingId(request.id);
                              act(() => reject.mutateAsync({ id: request.id }), '거절');
                            }}
                          >
                            거절
                          </Button>
                        </>
                      )}
                      {request.status === 'approved' && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={collectionPending.isPending}
                          onClick={() => act(() => collectionPending.mutateAsync(request.id), '수거 대기')}
                        >
                          수거 대기
                        </Button>
                      )}
                      {request.status === 'collection_pending' && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={collected.isPending}
                          onClick={() => act(() => collected.mutateAsync(request.id), '수거 완료')}
                        >
                          수거 완료
                        </Button>
                      )}
                      {request.status === 'collected' && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={inspected.isPending}
                          onClick={() => act(() => inspected.mutateAsync(request.id), '검수 완료')}
                        >
                          검수 완료
                        </Button>
                      )}
                      {request.status === 'inspected' && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={complete.isPending}
                          onClick={() => act(() => complete.mutateAsync(request.id), '처리 완료')}
                        >
                          완료 처리
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>총 {total}건</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
              이전
            </Button>
            <span className="self-center">{page} / {totalPages}</span>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
              다음
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
