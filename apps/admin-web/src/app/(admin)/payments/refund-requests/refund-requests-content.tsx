'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useRefundRequests, useApproveRefundRequest, useRejectRefundRequest } from '@/lib/services/wallet';
import { TOSS_BANKS } from '@/lib/constants/toss-banks';
import type { RefundRequestDto } from '@/lib/types/dto/wallet';

const bankLabel = (r: RefundRequestDto) =>
  r.bankName ?? TOSS_BANKS.find((b) => b.code === r.bankCode)?.name ?? r.bankCode;

const errMessage = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export function RefundRequestsContent() {
  const [page, setPage] = useState(1);
  const limit = 20;
  const { data, isLoading } = useRefundRequests(page, limit);
  const approve = useApproveRefundRequest();
  const reject = useRejectRefundRequest();

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  const handleApprove = async (id: string) => {
    try {
      await approve.mutateAsync({ id });
      toast.success('환불 승인 완료 — 토스가 환불계좌로 송금합니다 (약 2영업일)');
    } catch (e) {
      toast.error(errMessage(e, '환불 승인 실패'));
    }
  };

  const handleReject = async (id: string) => {
    try {
      await reject.mutateAsync({ id });
      toast.success('환불 요청 거절 처리');
    } catch (e) {
      toast.error(errMessage(e, '거절 처리 실패'));
    }
  };

  const busy = approve.isPending || reject.isPending;

  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b p-4">
        <h1 className="text-lg font-semibold">무통장 환불 요청</h1>
        <p className="text-sm text-muted-foreground">
          고객이 제출한 환불 요청입니다. 승인 시 저장된 계좌로 토스가 자동 송금하고 현금영수증도 취소됩니다.
          <span className="font-medium text-amber-600"> 승인 전 배송/반품 여부를 반드시 확인하세요.</span>
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">대기 중인 환불 요청이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">결제 ID</th>
                <th className="p-3">금액</th>
                <th className="p-3">환불 계좌</th>
                <th className="p-3">예금주</th>
                <th className="p-3">사유</th>
                <th className="p-3">신청일</th>
                <th className="p-3 text-right">처리</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-3 font-mono text-xs">
                    <Link
                      href={`/payments/${r.intentId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                      title="결제 상세(주문자·상품) 새 탭에서 열기"
                    >
                      {r.intentId.slice(0, 8)}…
                    </Link>
                  </td>
                  <td className="p-3 font-medium">
                    {r.amount.toLocaleString('ko-KR')} {r.currency}
                  </td>
                  <td className="p-3">
                    {bankLabel(r)} <span className="font-mono">{r.accountNumber}</span>
                  </td>
                  <td className="p-3">{r.holderName}</td>
                  <td className="p-3 text-muted-foreground">{r.reason ?? '-'}</td>
                  <td className="p-3 text-muted-foreground">{new Date(r.createdAt).toLocaleString('ko-KR')}</td>
                  <td className="p-3">
                    <div className="flex justify-end gap-2">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" disabled={busy}>
                            승인
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>환불 승인</AlertDialogTitle>
                            <AlertDialogDescription>
                              {bankLabel(r)} {r.accountNumber} ({r.holderName})로 {r.amount.toLocaleString('ko-KR')}원을
                              환불합니다. 토스가 자동 송금하며 되돌릴 수 없습니다. <br />
                              <span className="font-medium text-amber-600">
                                이미 배송/출고된 주문이 아닌지 확인하셨나요?
                              </span>
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>취소</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleApprove(r.id)}>승인 및 환불 실행</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="outline" disabled={busy}>
                            거절
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>환불 요청 거절</AlertDialogTitle>
                            <AlertDialogDescription>
                              {r.holderName} 고객의 {r.amount.toLocaleString('ko-KR')}원 환불 요청을 거절합니다. 실제
                              환불은 실행되지 않습니다.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>취소</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleReject(r.id)}>거절 처리</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > limit && (
        <div className="flex items-center justify-between border-t p-3 text-sm">
          <span className="text-muted-foreground">
            총 {total}건 · {page}페이지
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              이전
            </Button>
            <Button size="sm" variant="outline" disabled={page * limit >= total} onClick={() => setPage((p) => p + 1)}>
              다음
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
