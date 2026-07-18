'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { membershipApi } from '@/lib/api/domains/membership';
import { StuckBillingContractItem } from '@/lib/types/dto/membership';

const THRESHOLD_HOURS = 48;

export function StuckBillingView() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<StuckBillingContractItem | null>(null);
  const [reason, setReason] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['stuck-billing-contracts', THRESHOLD_HOURS],
    queryFn: () => membershipApi.getStuckBillingContracts(THRESHOLD_HOURS),
    staleTime: 30_000,
  });

  const resetMutation = useMutation({
    mutationFn: ({ contractId, reason }: { contractId: string; reason: string }) =>
      membershipApi.resetBillingInProgress(contractId, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['stuck-billing-contracts'] });
      setSelected(null);
      setReason('');
      toast.success('선점 플래그를 해제했습니다.');
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : '해제 실패. 다시 시도해주세요.');
    },
  });

  const rows = data?.data ?? [];

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        결제 결과를 받지 못해 {THRESHOLD_HOURS}시간 이상 선점(billingInProgress) 상태로 걸려 있는 계약입니다.
        reconcile 크론이 자동 복구하지만, 필요 시 수동으로 플래그를 해제할 수 있습니다.
      </p>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">불러오는 중...</p>
      ) : isError ? (
        <div className="flex flex-col items-center gap-2 rounded-md border py-8">
          <p className="text-sm text-destructive">목록을 불러오지 못했습니다.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            다시 시도
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">선점 고착 계약이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                <th className="p-2">계약 ID</th>
                <th className="p-2">회원 ID</th>
                <th className="p-2">선점 시작</th>
                <th className="p-2">경과</th>
                <th className="p-2">다음 결제일</th>
                <th className="p-2 text-right">작업</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.contractId} className="border-b last:border-0">
                  <td className="p-2 font-mono text-xs">{r.contractId.slice(0, 8)}…</td>
                  <td className="p-2 font-mono text-xs">{r.userId.slice(0, 10)}</td>
                  <td className="p-2">{new Date(r.billingInProgressSince).toLocaleString('ko-KR')}</td>
                  <td className="p-2">
                    <Badge variant="destructive">{Math.floor(r.hoursElapsed)}시간</Badge>
                  </td>
                  <td className="p-2">{r.nextBillingDate ?? '-'}</td>
                  <td className="p-2 text-right">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        setSelected(r);
                        setReason('');
                      }}
                    >
                      플래그 해제
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={!!selected}
        onOpenChange={(o) => {
          if (!o) {
            setSelected(null);
            setReason('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>선점 플래그 해제</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">해제 사유 (감사 기록용, 필수)</p>
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="예: 결제사 확인 완료, 해당 기간 미청구 처리 합의"
              className="text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSelected(null)}>
              취소
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={resetMutation.isPending || !reason.trim()}
              onClick={() =>
                selected && resetMutation.mutate({ contractId: selected.contractId, reason: reason.trim() })
              }
            >
              {resetMutation.isPending ? '해제 중...' : '플래그 해제'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
