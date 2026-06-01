'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useReturnRequests,
  useApproveReturn,
  useRejectReturn,
  useMarkReturnCollectionPending,
  useMarkReturnCollected,
  useMarkReturnInspected,
  useCompleteReturn,
  useRetryReturnRefund,
  useManualCompleteReturn,
} from '@/lib/services/return-exchange';
import type { ReturnRequest } from '@/lib/api/domains/return-exchange';

const STATUS_LABELS: Record<ReturnRequest['status'], string> = {
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

const STATUS_VARIANTS: Record<ReturnRequest['status'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
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

export function ReturnRequestsTable({ statusFilter, page, onPageChange }: Props) {
  const query = { status: statusFilter, page, limit: PAGE_SIZE };
  const { data, isLoading, isFetching } = useReturnRequests(query);

  const approve = useApproveReturn();
  const reject = useRejectReturn();
  const pending = useMarkReturnCollectionPending();
  const collected = useMarkReturnCollected();
  const inspected = useMarkReturnInspected();
  const complete = useCompleteReturn();
  const retryRefund = useRetryReturnRefund();
  const manualComplete = useManualCompleteReturn();

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [manualCompleteTarget, setManualCompleteTarget] = useState<string | null>(null);
  const [manualCompleteNote, setManualCompleteNote] = useState('');

  const act = async (fn: () => Promise<unknown>, label: string) => {
    try {
      await fn();
      toast.success(`${label} 처리되었습니다.`);
    } catch {
      toast.error(`${label} 처리에 실패했습니다.`);
    }
  };

  const handleManualComplete = async () => {
    if (!manualCompleteTarget || !manualCompleteNote.trim()) return;
    try {
      await manualComplete.mutateAsync({ id: manualCompleteTarget, adminNote: manualCompleteNote.trim() });
      toast.success('수동 완료 처리되었습니다.');
      setManualCompleteTarget(null);
      setManualCompleteNote('');
    } catch {
      toast.error('수동 완료 처리에 실패했습니다.');
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
                  반품 요청이 없습니다.
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
                          disabled={pending.isPending}
                          onClick={() => act(() => pending.mutateAsync(request.id), '수거 대기')}
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
                      {request.status === 'refund_pending' && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={retryRefund.isPending && confirmingId === request.id}
                            onClick={() => {
                              setConfirmingId(request.id);
                              act(() => retryRefund.mutateAsync(request.id), '환불 재시도');
                            }}
                          >
                            환불 재시도
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setManualCompleteTarget(request.id);
                              setManualCompleteNote('');
                            }}
                          >
                            수동 완료
                          </Button>
                        </>
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

      <Dialog
        open={!!manualCompleteTarget}
        onOpenChange={(open) => { if (!open) { setManualCompleteTarget(null); setManualCompleteNote(''); } }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>수동 환불 완료 확인</DialogTitle>
            <p className="text-sm text-muted-foreground mt-1">
              실제 환불(무통장 입금 확인 등)이 완료된 경우에만 사용하세요. 이 작업은 되돌릴 수 없습니다.
            </p>
          </DialogHeader>
          <div className="space-y-2">
            <Label>처리 사유 (필수)</Label>
            <textarea
              className="w-full rounded-md border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              rows={3}
              placeholder="예: 무통장 입금 확인 완료 — 담당자: 홍길동"
              value={manualCompleteNote}
              onChange={(e) => setManualCompleteNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setManualCompleteTarget(null); setManualCompleteNote(''); }}
              disabled={manualComplete.isPending}
            >
              취소
            </Button>
            <Button
              variant="default"
              onClick={handleManualComplete}
              disabled={manualComplete.isPending || !manualCompleteNote.trim()}
            >
              {manualComplete.isPending ? '처리 중...' : '완료 처리'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
